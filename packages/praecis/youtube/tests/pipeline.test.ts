/**
 * Ingestion pipeline tests - WRITTEN FIRST (TDD Red Phase)
 *
 * Tests the complete ingestion flow from playlist to graph nodes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore, SQLiteStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { ingestYouTubePlaylist } from '../src/ingest/runtime-ingestion.js';
import { createFixtureLlm, RuntimeIngestionHarness } from './helpers/runtime-ingestion.js';
import type { IngestionResult } from '../src/pipeline/types.js';
import type { ResolvedConfig } from '@aidha/config';

function productionSeededConfig(): ResolvedConfig {
  return {
    baseDir: process.cwd(),
    db: ':memory:',
    llm: {
      model: 'test-llm',
      apiKey: '',
      baseUrl: '',
      timeoutMs: 30_000,
      cacheDir: './out/cache/claims',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      embeddingBatchSize: 20,
      embeddingTaskType: 'SEMANTIC_SIMILARITY',
      embeddingOutputDimensionality: 768,
    },
    editor: {
      version: 'v2',
      windowMinutes: 5,
      maxPerWindow: 3,
      minWindows: 1,
      minWords: 1,
      minChars: 1,
      editorLlm: false,
    },
    extraction: { maxClaims: 10, chunkMinutes: 5, maxChunks: 0, promptVersion: 'v1' },
    export: { outDir: './out', sourcePrefix: '' },
    extensions: {
      global: {
        taxonomy: {
          categories: [{ id: 'cat-1', name: 'Technology' }],
          topics: [{ id: 'topic-1', name: 'Programming', categoryId: 'cat-1' }],
          tags: [{ id: 'tag-1', name: 'tutorial', topicIds: ['topic-1'] }],
        },
      },
    },
  };
}

const fixedClock = { now: () => new Date('2026-05-25T12:34:56.000Z') };

describe('production YouTube runtime ingestion', () => {
  let graphStore: InMemoryStore;
  let taxonomyRegistry: InMemoryRegistry;
  let youtubeClient: MockYouTubeClient;
  let pipeline: RuntimeIngestionHarness;

  beforeEach(async () => {
    graphStore = new InMemoryStore();
    taxonomyRegistry = new InMemoryRegistry();
    youtubeClient = new MockYouTubeClient();

    // Set up taxonomy
    await taxonomyRegistry.addCategory({ id: 'cat-1', name: 'Technology' });
    await taxonomyRegistry.addTopic({ id: 'topic-1', name: 'Programming', categoryId: 'cat-1' });
    await taxonomyRegistry.addTag({ id: 'tag-1', name: 'tutorial', topicIds: ['topic-1'] });

    pipeline = new RuntimeIngestionHarness({
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
      expect(excerptResult.value.items.length).toBe(2);

      const edgeResult = await graphStore.getEdges({ predicate: 'resourceHasExcerpt' });
      expect(edgeResult.ok).toBe(true);
      if (!edgeResult.ok) return;
      expect(edgeResult.value.items.length).toBe(2);

      const firstExcerpt = excerptResult.value.items.find(item => item.metadata?.['resourceId'] === 'youtube-test-video');
      expect(firstExcerpt).toBeDefined();
      if (!firstExcerpt) return;
      expect(firstExcerpt.metadata).toMatchObject({
        resourceId: 'youtube-test-video',
        speaker: 'Host',
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

    it('continues after a per-video failure and records deterministic job telemetry', async () => {
      const result = await ingestYouTubePlaylist({
        store: graphStore,
        client: youtubeClient,
        taxonomyRegistry,
        config: productionSeededConfig(),
        llm: createFixtureLlm(),
        services: { clock: fixedClock },
      }, 'partial-playlist');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.job).toEqual({
        id: 'job-partial-playlist',
        playlistId: 'partial-playlist',
        status: 'completed_with_errors',
        progress: { total: 2, completed: 1, failed: 1 },
        errors: [{
          videoId: 'missing-video',
          message: 'Video not found: missing-video',
          timestamp: '2026-05-25T12:34:56.000Z',
        }],
        createdAt: '2026-05-25T12:34:56.000Z',
        completedAt: '2026-05-25T12:34:56.000Z',
      });
      expect(result.value.videosProcessed).toBe(1);
      expect(result.value.nodeIds).toEqual(['youtube-test-video']);
      expect(result.value.videos.map(video => video.videoId)).toEqual(['test-video']);
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
      expect(nodeResult.value?.metadata).toMatchObject({
        videoId: 'test-video',
        channelId: 'UC-test',
        channelName: 'Test Channel',
        duration: 300,
        description: 'A test video about programming. Docs: https://example.com/docs',
        url: 'https://www.youtube.com/watch?v=test-video',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        transcriptStatus: 'available',
        transcriptLanguage: 'en',
      });
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

    it('refreshes stale transcript excerpts when requested', async () => {
      await graphStore.upsertNode(
        'Resource',
        'youtube-test-video',
        {
          label: 'Test Video',
          content: 'stale transcript',
          metadata: {
            videoId: 'test-video',
            transcriptStatus: 'available',
            transcriptLanguage: 'en',
          },
        },
        { detectNoop: true }
      );
      await graphStore.upsertNode(
        'Excerpt',
        'stale-excerpt',
        {
          label: 'Stale excerpt',
          content: 'stale excerpt text',
          metadata: {
            videoId: 'test-video',
            resourceId: 'youtube-test-video',
            start: 0,
            duration: 5,
            end: 5,
            sequence: 0,
            source: 'youtube',
          },
        },
        { detectNoop: true }
      );
      await graphStore.upsertEdge(
        'youtube-test-video',
        'resourceHasExcerpt',
        'stale-excerpt',
        { metadata: { sequence: 0, start: 0, duration: 5 } },
        { detectNoop: true }
      );

      const result = await pipeline.ingestVideo('test-video', { refreshTranscript: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const staleNode = await graphStore.getNode('stale-excerpt');
      expect(staleNode.ok).toBe(true);
      if (!staleNode.ok) return;
      expect(staleNode.value).toBeNull();

      const excerpts = await graphStore.queryNodes({
        type: 'Excerpt',
        filters: { resourceId: 'youtube-test-video' },
      });
      expect(excerpts.ok).toBe(true);
      if (!excerpts.ok) return;
      expect(excerpts.value.items.length).toBe(1);
      expect(excerpts.value.items.some(item => item.content?.includes('TypeScript'))).toBe(true);

      const resource = await graphStore.getNode('youtube-test-video');
      expect(resource.ok).toBe(true);
      if (!resource.ok || !resource.value) return;
      expect(resource.value.metadata?.['transcriptStatus']).toBe('available');
      expect(resource.value.metadata?.['channelName']).toBe('Test Channel');
    });

    it('returns err and preserves stale excerpts when transcript refresh fails', async () => {
      await graphStore.upsertNode(
        'Resource',
        'youtube-test-video',
        {
          label: 'Test Video',
          content: 'stale transcript',
          metadata: {
            videoId: 'test-video',
            transcriptStatus: 'available',
            transcriptLanguage: 'en',
          },
        },
        { detectNoop: true }
      );
      await graphStore.upsertNode(
        'Excerpt',
        'stale-excerpt',
        {
          label: 'Stale excerpt',
          content: 'stale excerpt text',
          metadata: {
            videoId: 'test-video',
            resourceId: 'youtube-test-video',
            start: 0,
            duration: 5,
            end: 5,
            sequence: 0,
            source: 'youtube',
          },
        },
        { detectNoop: true }
      );
      await graphStore.upsertEdge(
        'youtube-test-video',
        'resourceHasExcerpt',
        'stale-excerpt',
        { metadata: { sequence: 0, start: 0, duration: 5 } },
        { detectNoop: true }
      );

      youtubeClient.fetchTranscript = async () => ({
        ok: false,
        error: new Error('Transcript unavailable'),
      });

      const result = await pipeline.ingestVideo('test-video', { refreshTranscript: true });
      expect(result.ok).toBe(false);

      const staleNode = await graphStore.getNode('stale-excerpt');
      expect(staleNode.ok).toBe(true);
      if (!staleNode.ok) return;
      expect(staleNode.value).not.toBeNull();

      const excerpts = await graphStore.queryNodes({
        type: 'Excerpt',
        filters: { resourceId: 'youtube-test-video' },
      });
      expect(excerpts.ok).toBe(true);
      if (!excerpts.ok) return;
      expect(excerpts.value.items.length).toBe(1);

      const resource = await graphStore.getNode('youtube-test-video');
      expect(resource.ok).toBe(true);
      if (!resource.ok || !resource.value) return;
      // Content should be preserved, not wiped, when refresh fails
      expect(resource.value.content).toBe('stale transcript');
      expect(resource.value.metadata?.['transcriptStatus']).toBe('available');
      expect(resource.value.metadata?.['transcriptError']).toBeUndefined();
    });

    it('returns err and persists no Resource when a video has no transcript', async () => {
      const result = await pipeline.ingestVideo('no-transcript-video');
      expect(result.ok).toBe(false);

      const resource = await graphStore.getNode('youtube-no-transcript-video');
      expect(resource.ok).toBe(true);
      if (!resource.ok) return;
      expect(resource.value).toBeNull();
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
    it('assigns tags from production config without hand-injected registry', async () => {
      const result = await ingestYouTubePlaylist({
        store: graphStore,
        client: youtubeClient,
        config: productionSeededConfig(),
        llm: createFixtureLlm(),
      }, 'test-playlist');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.classification).toMatchObject({
        status: 'completed',
        tagsMatched: 1,
        tagsAssigned: 1,
      });
    });

    it('persists config-seeded tags across fresh SQLite-backed ingests', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'aidha-youtube-taxonomy-'));
      const dbPath = join(dir, 'graph.sqlite');
      const config = { ...productionSeededConfig(), db: dbPath };
      const firstStore = SQLiteStore.open(dbPath);
      try {
        const first = await ingestYouTubePlaylist({
          store: firstStore,
          client: new MockYouTubeClient(),
          config,
          llm: createFixtureLlm(),
          services: { clock: fixedClock },
        }, 'test-playlist');
        expect(first.ok).toBe(true);
        if (!first.ok) throw first.error;
        expect(first.value.classification).toMatchObject({
          status: 'completed',
          tagsMatched: 1,
          tagsAssigned: 1,
        });
      } finally {
        await firstStore.close();
      }

      const secondStore = SQLiteStore.open(dbPath);
      try {
        const second = await ingestYouTubePlaylist({
          store: secondStore,
          client: new MockYouTubeClient(),
          config,
          llm: createFixtureLlm(),
          services: { clock: fixedClock },
        }, 'test-playlist');
        expect(second.ok).toBe(true);
        if (!second.ok) throw second.error;
        expect(second.value.classification).toMatchObject({
          status: 'completed',
          tagsMatched: 1,
          tagsAssigned: 0,
        });

        const resource = await secondStore.getNode('youtube-test-video');
        expect(resource.ok).toBe(true);
        if (!resource.ok) throw resource.error;
        expect(resource.value?.metadata?.['taxonomyAssignments']).toEqual([{
          nodeId: 'youtube-test-video',
          tagId: 'tag-1',
          confidence: 0.7,
          source: 'automatic',
          taxonomyVersion: expect.any(String),
          assignedAt: '2026-05-25T12:34:56.000Z',
          assignedBy: 'praecis-keyword-classifier',
        }]);
      } finally {
        await secondStore.close();
        await rm(dir, { recursive: true, force: true });
      }
    }, 15_000);

    it('assigns tags to video nodes', async () => {
      const result = await pipeline.ingestPlaylist('test-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.classification.tagsAssigned).toBe(1);
      const assignments = await taxonomyRegistry.getAssignments('youtube-test-video');
      expect(assignments.ok).toBe(true);
      if (!assignments.ok) return;
      expect(assignments.value).toMatchObject([{
        nodeId: 'youtube-test-video',
        tagId: 'tag-1',
        confidence: 0.7,
        source: 'automatic',
        assignedBy: 'praecis-keyword-classifier',
      }]);
    });
  });
});
