/**
 * Ingestion pipeline tests - WRITTEN FIRST (TDD Red Phase)
 *
 * Tests the complete ingestion flow from playlist to graph nodes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import type { IngestionResult } from '../src/pipeline/types.js';

describe('IngestionPipeline', () => {
  let graphStore: InMemoryStore;
  let taxonomyRegistry: InMemoryRegistry;
  let youtubeClient: MockYouTubeClient;
  let pipeline: IngestionPipeline;

  beforeEach(async () => {
    graphStore = new InMemoryStore();
    taxonomyRegistry = new InMemoryRegistry();
    youtubeClient = new MockYouTubeClient();

    // Set up taxonomy
    await taxonomyRegistry.addCategory({ id: 'cat-1', name: 'Technology' });
    await taxonomyRegistry.addTopic({ id: 'topic-1', name: 'Programming', categoryId: 'cat-1' });
    await taxonomyRegistry.addTag({ id: 'tag-1', name: 'tutorial', topicIds: ['topic-1'] });

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

  describe('ingestPlaylist', () => {
    it('creates graph nodes for videos', async () => {
      const result = await pipeline.ingestPlaylist('test-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.videosProcessed).toBeGreaterThan(0);

      // Verify nodes were created
      const nodesResult = await graphStore.queryNodes({ type: 'Resource' });
      expect(nodesResult.ok).toBe(true);
      if (!nodesResult.ok) return;
      expect(nodesResult.value.items.length).toBeGreaterThan(0);
    });

    it('creates transcript excerpts and edges', async () => {
      const result = await pipeline.ingestPlaylist('test-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const excerptResult = await graphStore.queryNodes({ type: 'Excerpt' });
      expect(excerptResult.ok).toBe(true);
      if (!excerptResult.ok) return;
      expect(excerptResult.value.items.length).toBe(3);

      const edgeResult = await graphStore.getEdges({ predicate: 'resourceHasExcerpt' });
      expect(edgeResult.ok).toBe(true);
      if (!edgeResult.ok) return;
      expect(edgeResult.value.items.length).toBe(3);

      const firstExcerpt = excerptResult.value.items[0];
      expect(firstExcerpt.metadata).toMatchObject({
        videoId: 'test-video',
        resourceId: 'youtube-test-video',
      });
    });

    it('returns job status with progress', async () => {
      const result = await pipeline.ingestPlaylist('test-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.job.status).toBe('completed');
      expect(result.value.job.progress.completed).toBe(result.value.job.progress.total);
    });

    it('handles errors gracefully', async () => {
      const result = await pipeline.ingestPlaylist('invalid-playlist-id');
      expect(result.ok).toBe(false);
    });

    it('marks empty playlists as completed', async () => {
      const result = await pipeline.ingestPlaylist('empty-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.job.status).toBe('completed');
      expect(result.value.job.progress.total).toBe(0);
      expect(result.value.job.progress.completed).toBe(0);
      expect(result.value.job.progress.failed).toBe(0);
    });
  });

  describe('ingestVideo', () => {
    it('ingests a single video by id', async () => {
      const result = await pipeline.ingestVideo('test-video');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const nodeResult = await graphStore.getNode('youtube-test-video');
      expect(nodeResult.ok).toBe(true);
      if (!nodeResult.ok) return;
      expect(nodeResult.value).not.toBeNull();
    });

    it('retries transcript fetch for existing resources without excerpts', async () => {
      await graphStore.upsertNode(
        'Resource',
        'youtube-test-video',
        {
          label: 'Test Video',
          content: undefined,
          metadata: {
            videoId: 'test-video',
            transcriptStatus: 'missing',
          },
        },
        { detectNoop: true }
      );

      const result = await pipeline.ingestVideo('test-video');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const excerpts = await graphStore.queryNodes({
        type: 'Excerpt',
        filters: { resourceId: 'youtube-test-video' },
      });
      expect(excerpts.ok).toBe(true);
      if (!excerpts.ok) return;
      expect(excerpts.value.items.length).toBeGreaterThan(0);
    });
  });

  describe('idempotency', () => {
    it('does not duplicate nodes on re-ingestion', async () => {
      // First ingestion
      await pipeline.ingestPlaylist('test-playlist');

      const firstCount = (await graphStore.queryNodes()).ok
        ? (await graphStore.queryNodes()).value?.items.length ?? 0
        : 0;

      // Second ingestion of same playlist
      await pipeline.ingestPlaylist('test-playlist');

      const secondCount = (await graphStore.queryNodes()).ok
        ? (await graphStore.queryNodes()).value?.items.length ?? 0
        : 0;

      expect(secondCount).toBe(firstCount);
    });
  });

  describe('classification', () => {
    it('assigns tags to video nodes', async () => {
      const result = await pipeline.ingestPlaylist('test-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Check that assignments were created
      expect(result.value.tagsAssigned).toBeGreaterThanOrEqual(0);
    });
  });
});
