/**
 * Ingestion status tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { getIngestionStatus } from '../src/pipeline/status.js';

describe('getIngestionStatus', () => {
  let graphStore: InMemoryStore;
  let taxonomyRegistry: InMemoryRegistry;
  let youtubeClient: MockYouTubeClient;
  let pipeline: IngestionPipeline;

  beforeEach(async () => {
    graphStore = new InMemoryStore();
    taxonomyRegistry = new InMemoryRegistry();
    youtubeClient = new MockYouTubeClient();
    pipeline = new IngestionPipeline({
      graphStore,
      taxonomyRegistry,
      youtubeClient,
    });
  });

  afterEach(async () => {
    await graphStore.close();
    await taxonomyRegistry.close();
  });

  it('reports transcript status and counts', async () => {
    const ingest = await pipeline.ingestVideo('test-video');
    expect(ingest.ok).toBe(true);
    if (!ingest.ok) return;

    const status = await getIngestionStatus(graphStore, 'test-video');
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    expect(status.value.resourceId).toBe('youtube-test-video');
    expect(status.value.excerptCount).toBeGreaterThan(0);
    expect(status.value.transcriptStatus).toBe('available');
    expect(status.value.claimCount).toBe(0);
    expect(status.value.referenceCount).toBe(0);
  });
});
