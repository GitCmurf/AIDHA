/**
 * Retrieval search tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { searchClaims } from '../src/retrieve/query.js';
import { createTaskFromClaim, DEFAULT_INBOX_PROJECT_ID } from '../src/tasks/index.js';

describe('searchClaims', () => {
  let graphStore: InMemoryStore;
  let taxonomyRegistry: InMemoryRegistry;
  let youtubeClient: MockYouTubeClient;
  let ingestion: IngestionPipeline;

  beforeEach(async () => {
    graphStore = new InMemoryStore();
    taxonomyRegistry = new InMemoryRegistry();
    youtubeClient = new MockYouTubeClient();
    ingestion = new IngestionPipeline({
      graphStore,
      taxonomyRegistry,
      youtubeClient,
    });
  });

  afterEach(async () => {
    await graphStore.close();
    await taxonomyRegistry.close();
  });

  async function setClaimState(claimId: string, state: 'draft' | 'accepted' | 'rejected') {
    const current = await graphStore.getNode(claimId);
    expect(current.ok).toBe(true);
    if (!current.ok || !current.value) return;
    const metadata = { ...(current.value.metadata ?? {}), state };
    await graphStore.upsertNode(
      'Claim',
      claimId,
      {
        label: current.value.label,
        content: current.value.content,
        metadata,
      },
      { detectNoop: true }
    );
  }

  it('returns matching claim results with timestamps', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const result = await searchClaims(graphStore, { query: 'TypeScript' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);

    const hit = result.value[0];
    expect(hit.claimText).toContain('TypeScript');
    expect(hit.timestampUrl).toContain('t=');
    expect(hit.resourceTitle).toBe('Test Video');
  });

  it('filters claims by project', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    const target = claims.value.items.find(item => (item.content ?? '').includes('TypeScript'))
      ?? claims.value.items[0];
    expect(target).toBeTruthy();
    if (!target) return;

    const taskResult = await createTaskFromClaim(graphStore, {
      claimId: target.id,
      title: 'Follow up on claim',
    });
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;

    const result = await searchClaims(graphStore, {
      query: 'TypeScript',
      projectId: DEFAULT_INBOX_PROJECT_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.claimId).toBe(target.id);
  });

  it('returns results for benchmark queries', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const first = await searchClaims(graphStore, { query: 'TypeScript' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.length).toBeGreaterThan(0);

    const second = await searchClaims(graphStore, { query: 'tutorial' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.length).toBeGreaterThan(0);
  });

  it('filters out draft and rejected claims by default', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    const items = claims.value.items;
    expect(items.length).toBeGreaterThan(0);
    const target =
      items.find(item => (item.content ?? '').includes('TypeScript')) ?? items[0];
    if (!target) return;

    for (const claim of items) {
      await setClaimState(claim.id, 'rejected');
    }
    await setClaimState(target.id, 'accepted');

    const result = await searchClaims(graphStore, { query: 'TypeScript' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]?.claimId).toBe(target.id);
  });
});
