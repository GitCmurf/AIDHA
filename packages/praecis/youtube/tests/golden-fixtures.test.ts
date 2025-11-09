import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import type { ClaimCandidate, ClaimExtractionInput, ClaimExtractor } from '../src/extract/types.js';

type FixtureSegment = {
  id: string;
  sequence: number;
  start: number;
  duration: number;
  text: string;
};

type GoldenFixture = {
  fixtureVersion: number;
  videoId: string;
  sourceUrl: string;
  transcriptTrack: string;
  parser: string;
  transcriptHash: string;
  segmentCount: number;
  segments: FixtureSegment[];
};

const FIXTURE_CONFIG = [
  {
    file: 'testdata/youtube_golden/UepWRYgBpv0.excerpts.json',
    durationMin: 3600,
    durationMax: 3900,
  },
] as const;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');

async function loadFixture(path: string): Promise<GoldenFixture> {
  const raw = await readFile(resolve(REPO_ROOT, path), 'utf-8');
  return JSON.parse(raw) as GoldenFixture;
}

class FixtureClaimExtractor implements ClaimExtractor {
  async extractClaims(input: ClaimExtractionInput): Promise<ClaimCandidate[]> {
    const maxClaims = Math.min(20, Math.max(10, input.maxClaims ?? 15));
    const candidates = input.excerpts
      .map(excerpt => ({
        excerptId: excerpt.id,
        text: excerpt.content ?? '',
        start: typeof excerpt.metadata?.['start'] === 'number'
          ? (excerpt.metadata['start'] as number)
          : 0,
      }))
      .filter(candidate => candidate.text.trim().length >= 30)
      .sort((left, right) => left.start - right.start);

    const selected: ClaimCandidate[] = [];
    const seenBuckets = new Set<number>();
    for (const candidate of candidates) {
      if (selected.length >= maxClaims) break;
      const bucket = Math.floor(candidate.start / 300);
      if (!seenBuckets.has(bucket) || selected.length < 8) {
        selected.push({
          text: candidate.text.trim(),
          excerptIds: [candidate.excerptId],
          confidence: 0.75,
          startSeconds: candidate.start,
          method: 'heuristic',
        });
        seenBuckets.add(bucket);
      }
    }

    let index = 0;
    while (selected.length < maxClaims && index < candidates.length) {
      const candidate = candidates[index];
      index += 1;
      if (!candidate) continue;
      if (selected.some(item => item.excerptIds[0] === candidate.excerptId)) continue;
      selected.push({
        text: candidate.text.trim(),
        excerptIds: [candidate.excerptId],
        confidence: 0.7,
        startSeconds: candidate.start,
        method: 'heuristic',
      });
    }

    return selected.slice(0, maxClaims);
  }
}

async function seedFixtureStore(store: InMemoryStore, fixture: GoldenFixture): Promise<void> {
  const resourceId = `youtube-${fixture.videoId}`;
  await store.upsertNode(
    'Resource',
    resourceId,
    {
      label: `Golden fixture ${fixture.videoId}`,
      metadata: {
        videoId: fixture.videoId,
        url: fixture.sourceUrl,
        transcriptStatus: 'available',
        transcriptLanguage: 'en',
      },
    },
    { detectNoop: true }
  );

  for (const segment of fixture.segments) {
    await store.upsertNode(
      'Excerpt',
      segment.id,
      {
        label: `Golden excerpt ${segment.sequence}`,
        content: segment.text,
        metadata: {
          resourceId,
          videoId: fixture.videoId,
          start: segment.start,
          duration: segment.duration,
          sequence: segment.sequence,
        },
      },
      { detectNoop: true }
    );
  }
}

async function extractFingerprint(fixture: GoldenFixture): Promise<{ claimIds: string[]; digest: string }> {
  const store = new InMemoryStore();
  try {
    await seedFixtureStore(store, fixture);
    const pipeline = new ClaimExtractionPipeline({
      graphStore: store,
      extractor: new FixtureClaimExtractor(),
    });
    const result = await pipeline.extractClaimsForVideo(fixture.videoId, { maxClaims: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const claimsResult = await store.queryNodes({
      type: 'Claim',
      filters: { resourceId: `youtube-${fixture.videoId}` },
      sort: 'id:asc',
    });
    expect(claimsResult.ok).toBe(true);
    if (!claimsResult.ok) throw claimsResult.error;

    const fingerprint = createHash('sha256');
    const claimIds = claimsResult.value.items.map(claim => claim.id);
    for (const claim of claimsResult.value.items) {
      fingerprint.update(claim.id);
      fingerprint.update('|');
      fingerprint.update(claim.content ?? '');
      fingerprint.update('\n');
    }

    return { claimIds, digest: fingerprint.digest('hex') };
  } finally {
    await store.close();
  }
}

describe('golden YouTube transcript fixtures', () => {
  it('loads fixtures and enforces extraction invariants offline', async () => {
    for (const config of FIXTURE_CONFIG) {
      const fixture = await loadFixture(config.file);
      expect(fixture.fixtureVersion).toBe(1);
      expect(fixture.segmentCount).toBe(fixture.segments.length);
      expect(fixture.segments.length).toBeGreaterThan(500);

      const firstStart = fixture.segments[0]?.start ?? 0;
      const lastEnd = fixture.segments
        .map(segment => segment.start + segment.duration)
        .reduce((max, value) => Math.max(max, value), 0);
      const coverage = lastEnd - firstStart;
      expect(coverage).toBeGreaterThan(config.durationMin);
      expect(coverage).toBeLessThan(config.durationMax);

      const store = new InMemoryStore();
      try {
        await seedFixtureStore(store, fixture);

        const excerptResult = await store.queryNodes({
          type: 'Excerpt',
          filters: { resourceId: `youtube-${fixture.videoId}` },
        });
        expect(excerptResult.ok).toBe(true);
        if (!excerptResult.ok) throw excerptResult.error;
        expect(excerptResult.value.items.length).toBe(fixture.segmentCount);

        const pipeline = new ClaimExtractionPipeline({
          graphStore: store,
          extractor: new FixtureClaimExtractor(),
        });
        const extraction = await pipeline.extractClaimsForVideo(fixture.videoId, { maxClaims: 15 });
        expect(extraction.ok).toBe(true);
        if (!extraction.ok) throw extraction.error;

        const claimsResult = await store.queryNodes({
          type: 'Claim',
          filters: { resourceId: `youtube-${fixture.videoId}` },
        });
        expect(claimsResult.ok).toBe(true);
        if (!claimsResult.ok) throw claimsResult.error;
        expect(claimsResult.value.items.length).toBeGreaterThanOrEqual(10);
        expect(claimsResult.value.items.length).toBeLessThanOrEqual(20);

        const claimIds = new Set(claimsResult.value.items.map(claim => claim.id));
        const excerptIds = new Set(fixture.segments.map(segment => segment.id));

        const edgesResult = await store.getEdges({ predicate: 'claimDerivedFrom' });
        expect(edgesResult.ok).toBe(true);
        if (!edgesResult.ok) throw edgesResult.error;

        const provenanceEdges = edgesResult.value.items.filter(edge => claimIds.has(edge.subject));
        expect(provenanceEdges.length).toBeGreaterThan(0);

        const edgesByClaim = new Map<string, string[]>();
        for (const edge of provenanceEdges) {
          if (!excerptIds.has(edge.object)) {
            throw new Error(`Invalid excerpt reference: ${edge.object}`);
          }
          const current = edgesByClaim.get(edge.subject) ?? [];
          current.push(edge.object);
          edgesByClaim.set(edge.subject, current);
        }

        for (const claimId of claimIds) {
          const linked = edgesByClaim.get(claimId) ?? [];
          expect(linked.length).toBeGreaterThan(0);
        }

        const startByExcerpt = new Map(fixture.segments.map(segment => [segment.id, segment.start]));
        const buckets = new Set<number>();
        for (const claimId of claimIds) {
          const linked = edgesByClaim.get(claimId) ?? [];
          const starts = linked.map(excerptId => startByExcerpt.get(excerptId) ?? 0);
          const claimStart = Math.min(...starts);
          buckets.add(Math.floor(claimStart / 300));
        }

        expect(buckets.size).toBeGreaterThanOrEqual(4);
      } finally {
        await store.close();
      }
    }
  }, 120_000);

  it('is deterministic across reruns with identical fixture input', async () => {
    for (const config of FIXTURE_CONFIG) {
      const fixture = await loadFixture(config.file);
      const first = await extractFingerprint(fixture);
      const second = await extractFingerprint(fixture);

      expect(first.claimIds).toEqual(second.claimIds);
      expect(first.digest).toBe(second.digest);
    }
  }, 120_000);
});
