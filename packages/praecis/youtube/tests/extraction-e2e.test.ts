/**
 * End-to-end integration test for the full extraction pipeline.
 *
 * This test validates the complete flow from transcript ingestion to claim extraction,
 * ensuring all components work together correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { ReferenceExtractionPipeline } from '../src/extract/references.js';

describe('Full extraction pipeline integration', () => {
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

  it('ingests transcript and extracts claims in a single pipeline run', async () => {
    // Step 1: Ingest video and transcript
    const ingestResult = await ingestion.ingestVideo('test-video');
    expect(ingestResult.ok).toBe(true);
    if (!ingestResult.ok) return;

    // Step 2: Extract claims
    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    const claimResult = await claimPipeline.extractClaimsForVideo('test-video');
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;

    // Validate results
    expect(claimResult.value.claimsCreated).toBeGreaterThan(0);

    // Verify claims are stored in graph
    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items.length).toBeGreaterThan(0);

    // Verify claim edges are created
    const edges = await graphStore.getEdges({ predicate: 'claimDerivedFrom' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBeGreaterThan(0);
  });

  it('maintains idempotency across multiple extraction runs', async () => {
    await ingestion.ingestVideo('test-video');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });

    // First run
    const result1 = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    const claimsCreated1 = result1.value.claimsCreated;

    // Second run (should be idempotent)
    const result2 = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    const claimsCreated2 = result2.value.claimsCreated;

    // Second run should create fewer claims (many will be noops due to deduplication)
    expect(claimsCreated2).toBeLessThanOrEqual(claimsCreated1);
  });

  it('extracts claims with proper metadata and provenance', async () => {
    await ingestion.ingestVideo('test-video');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;

    // Check first claim has required metadata
    const firstClaim = claims.value.items[0];
    expect(firstClaim).toBeTruthy();
    if (!firstClaim) return;

    const metadata = firstClaim.metadata as Record<string, unknown>;
    expect(metadata).toHaveProperty('method');
    expect(metadata).toHaveProperty('confidence');
    expect(metadata).toHaveProperty('state');
    expect(metadata).toHaveProperty('resourceId');
    expect(metadata).toHaveProperty('videoId');
    expect(metadata).toHaveProperty('startSeconds');
  });

  it('integrates with reference extraction pipeline', async () => {
    await ingestion.ingestVideo('test-video');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    // Extract references from claims
    const refPipeline = new ReferenceExtractionPipeline({ graphStore });
    const refResult = await refPipeline.extractReferencesForVideo('test-video');
    expect(refResult.ok).toBe(true);
    if (!refResult.ok) return;

    // Should find the example.com reference in the transcript
    const refs = await graphStore.queryNodes({ type: 'Reference' });
    expect(refs.ok).toBe(true);
    if (!refs.ok) return;

    const exampleRef = refs.value.items.find(r =>
      (r.metadata?.['url'] as string)?.includes('example.com')
    );
    expect(exampleRef).toBeDefined();
  });

  it('updates resource metadata with extraction statistics', async () => {
    await ingestion.ingestVideo('test-video');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const resource = await graphStore.getNode('youtube-test-video');
    expect(resource.ok).toBe(true);
    if (!resource.ok) return;
    expect(resource.value).toBeTruthy();

    const metadata = resource.value?.metadata as Record<string, unknown>;
    expect(metadata).toHaveProperty('lastClaimRunAt');
    expect(metadata).toHaveProperty('lastClaimRunCandidates');
    expect(metadata).toHaveProperty('lastClaimRunCreated');
    expect(metadata).toHaveProperty('lastClaimRunEdgesCreated');
    expect(metadata).toHaveProperty('lastClaimRunEditorVersion');
  });
});
