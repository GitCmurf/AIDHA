/**
 * Extraction pipeline tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { ReferenceExtractionPipeline } from '../src/extract/references.js';

describe('Extraction pipelines', () => {
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

  it('extracts claims with provenance edges', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    const result = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimsCreated).toBeGreaterThan(0);

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items.length).toBeGreaterThan(0);

    const edges = await graphStore.getEdges({ predicate: 'claimDerivedFrom' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBeGreaterThan(0);
  });

  it('extracts references and links claims', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    const claimResult = await claimPipeline.extractClaimsForVideo('test-video');
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;

    const refPipeline = new ReferenceExtractionPipeline({ graphStore });
    const result = await refPipeline.extractReferencesForVideo('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.referencesCreated).toBeGreaterThan(0);

    const refs = await graphStore.queryNodes({ type: 'Reference' });
    expect(refs.ok).toBe(true);
    if (!refs.ok) return;
    const urls = refs.value.items.map(ref => ref.metadata?.url).filter(Boolean);
    expect(urls).toContain('https://example.com/docs');

    const edges = await graphStore.getEdges({ predicate: 'claimMentionsReference' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBeGreaterThan(0);
  });
});
