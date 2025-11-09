import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { searchClaims } from '../src/retrieve/query.js';

type FixtureSegment = {
  id: string;
  sequence: number;
  start: number;
  duration: number;
  text: string;
};

type GoldenFixture = {
  videoId: string;
  sourceUrl: string;
  segments: FixtureSegment[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');

async function loadFixture(videoId: string): Promise<GoldenFixture> {
  const path = resolve(REPO_ROOT, `testdata/youtube_golden/${videoId}.excerpts.json`);
  return JSON.parse(await readFile(path, 'utf-8')) as GoldenFixture;
}

async function seedResource(store: InMemoryStore, fixture: GoldenFixture): Promise<void> {
  const resourceId = `youtube-${fixture.videoId}`;
  await store.upsertNode('Resource', resourceId, {
    label: `Golden ${fixture.videoId}`,
    metadata: {
      videoId: fixture.videoId,
      url: fixture.sourceUrl,
      transcriptStatus: 'available',
    },
  });

  for (const segment of fixture.segments) {
    await store.upsertNode('Excerpt', segment.id, {
      label: `Excerpt ${segment.sequence}`,
      content: segment.text,
      metadata: {
        resourceId,
        videoId: fixture.videoId,
        start: segment.start,
        duration: segment.duration,
        sequence: segment.sequence,
      },
    });
  }
}

async function addClaimFromKeyword(
  store: InMemoryStore,
  fixture: GoldenFixture,
  keyword: string,
  claimId: string,
  state: 'accepted' | 'draft' | 'rejected'
): Promise<void> {
  const excerpt = fixture.segments.find(segment => segment.text.toLowerCase().includes(keyword.toLowerCase()));
  expect(excerpt).toBeTruthy();
  if (!excerpt) return;
  const resourceId = `youtube-${fixture.videoId}`;
  await store.upsertNode('Claim', claimId, {
    label: claimId,
    content: excerpt.text,
    metadata: {
      resourceId,
      videoId: fixture.videoId,
      state,
      method: 'fixture',
    },
  });
  await store.upsertEdge(claimId, 'claimDerivedFrom', excerpt.id, {}, { detectNoop: true });
}

describe('query regression on golden fixtures', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('returns expected accepted claim hits for stable query terms', async () => {
    const fixture = await loadFixture('UepWRYgBpv0');
    await seedResource(store, fixture);

    await addClaimFromKeyword(store, fixture, 'webinar', 'claim-webinar-accepted', 'accepted');
    await addClaimFromKeyword(store, fixture, 'webinar', 'claim-webinar-draft', 'draft');
    await addClaimFromKeyword(store, fixture, 'students', 'claim-students-accepted', 'accepted');

    const webinarResult = await searchClaims(store, { query: 'webinar', limit: 10 });
    expect(webinarResult.ok).toBe(true);
    if (!webinarResult.ok) return;
    const webinarIds = webinarResult.value.map(item => item.claimId);
    expect(webinarIds).toContain('claim-webinar-accepted');
    expect(webinarIds).not.toContain('claim-webinar-draft');

    const studentsResult = await searchClaims(store, { query: 'students', limit: 10 });
    expect(studentsResult.ok).toBe(true);
    if (!studentsResult.ok) return;
    const studentIds = studentsResult.value.map(item => item.claimId);
    expect(studentIds).toContain('claim-students-accepted');
  });
});
