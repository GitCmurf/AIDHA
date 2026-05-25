import type { GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { TaxonomyRegistry } from '@aidha/taxonomy';
import {
  composeVector,
  createDefaultPipelineServices,
  createPipelineRuntime,
  type LlmClient,
  type LlmCompletionRequest,
} from '@aidha/praecis-core';
import type { YouTubeClient } from '../../src/client/types.js';
import { createYouTubeVectorSpec } from '../../src/ingest/index.js';
import type { IngestionJob } from '../../src/schema/index.js';
import type { IngestVideoOptions, IngestionResult, Result } from '../../src/pipeline/types.js';

export interface RuntimeIngestionConfig {
  graphStore: GraphStore;
  taxonomyRegistry: TaxonomyRegistry;
  youtubeClient: YouTubeClient;
}

function now(): string {
  return new Date().toISOString();
}

function createFixtureLlm(): LlmClient {
  return {
    async generate(request: LlmCompletionRequest) {
      const excerptIds = Array.from(new Set(
        request.user.match(/youtube-[A-Za-z0-9_-]+:excerpt:[a-f0-9]{16,32}|\b(?:seg-)?[a-f0-9]{16,32}\b/gu) ?? [],
      ));
      return {
        ok: true as const,
        value: JSON.stringify({
          claims: [{
            text: 'The test transcript contains a claim-worthy point for review.',
            excerptIds: [excerptIds[0] ?? 'mock-excerpt'],
            startSeconds: 0,
            type: 'claim',
            classification: 'fact',
            domain: 'General',
            confidence: 0.9,
            why: 'Deterministic test extraction keeps runtime ingestion offline.',
            method: 'llm',
          }],
        }),
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      };
    },
  };
}

export class RuntimeIngestionHarness {
  constructor(private readonly config: RuntimeIngestionConfig) {
    void config.taxonomyRegistry;
  }

  async ingestPlaylist(playlistId: string): Promise<Result<IngestionResult>> {
    const playlist = await this.config.youtubeClient.fetchPlaylist(playlistId);
    if (!playlist.ok) return playlist;

    const errors: IngestionJob['errors'] = [];
    const nodeIds: string[] = [];
    for (const videoId of playlist.value.videoIds) {
      const result = await this.ingestVideo(videoId);
      if (result.ok) {
        nodeIds.push(result.value.nodeId);
      } else {
        errors.push({ videoId, message: result.error.message, timestamp: now() });
      }
    }

    const job: IngestionJob = {
      id: `job-${playlistId}`,
      playlistId,
      status: errors.length === playlist.value.videoIds.length && errors.length > 0 ? 'failed' : 'completed',
      progress: {
        total: playlist.value.videoIds.length,
        completed: playlist.value.videoIds.length - errors.length,
        failed: errors.length,
      },
      errors,
      createdAt: now(),
      completedAt: now(),
    };

    return {
      ok: true,
      value: {
        job,
        videosProcessed: job.progress.completed,
        tagsAssigned: 0,
        nodeIds,
      },
    };
  }

  async ingestVideo(
    videoId: string,
    options: IngestVideoOptions = {},
  ): Promise<Result<{ nodeId: string; tagsAssigned: number; created: boolean }>> {
    const video = await this.config.youtubeClient.fetchVideo(videoId);
    if (!video.ok) return video;

    const transcript = await this.config.youtubeClient.fetchTranscript(videoId);
    if (!transcript.ok) {
      const existing = await this.config.graphStore.getNode(`youtube-${videoId}`);
      if (!existing.ok) return existing;
      if (existing.value?.metadata?.['transcriptStatus'] === 'available') {
        return { ok: true, value: { nodeId: `youtube-${videoId}`, tagsAssigned: 0, created: false } };
      }
      const result = await this.config.graphStore.upsertNode(
        'Resource',
        `youtube-${videoId}`,
        {
          label: video.value.title,
          metadata: {
            videoId,
            channelId: video.value.channelId,
            channelName: video.value.channelName,
            duration: video.value.duration,
            publishedAt: video.value.publishedAt,
            description: video.value.description,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            source: 'youtube',
            sourceType: 'youtube',
            thumbnailUrl: video.value.thumbnailUrl,
            transcriptStatus: 'missing',
            transcriptError: transcript.error.message,
          },
        },
        { detectNoop: true },
      );
      if (!result.ok) return result;
      return { ok: true, value: { nodeId: `youtube-${videoId}`, tagsAssigned: 0, created: result.value.created } };
    }

    if (options.refreshTranscript) {
      const existingExcerpts = await this.config.graphStore.queryNodes({
        type: 'Excerpt',
        filters: { resourceId: `youtube-${videoId}` },
      });
      if (!existingExcerpts.ok) return existingExcerpts;
      for (const excerpt of existingExcerpts.value.items) {
        const deleted = await this.config.graphStore.deleteNode(excerpt.id, { cascade: true });
        if (!deleted.ok) return deleted;
      }
    }

    const runtime = createPipelineRuntime(createDefaultPipelineServices({
      store: this.config.graphStore,
      llm: createFixtureLlm(),
      config: {
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
        extraction: {
          maxClaims: 10,
          chunkMinutes: 5,
          maxChunks: 0,
          promptVersion: 'v1',
        },
        export: {
          outDir: './out',
          sourcePrefix: '',
        },
      },
    }));
    runtime.register(composeVector(createYouTubeVectorSpec(this.config.youtubeClient)));
    const run = await runtime.run('youtube', { ref: videoId });
    if (!run.ok) return run;

    const existing = await this.config.graphStore.getNode(run.value.resourceId);
    if (!existing.ok) return existing;
    const metadata = {
      ...(existing.value?.metadata ?? {}),
      videoId,
      channelId: video.value.channelId,
      channelName: video.value.channelName,
      duration: video.value.duration,
      publishedAt: video.value.publishedAt,
      description: video.value.description,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      source: 'youtube',
      sourceType: 'youtube',
      thumbnailUrl: video.value.thumbnailUrl,
      transcriptStatus: 'available',
      transcriptLanguage: transcript.value.language,
    };
    const update: NodeDataInput = {
      label: video.value.title,
      content: transcript.value.fullText,
      metadata,
    };
    const saved = await this.config.graphStore.upsertNode('Resource', run.value.resourceId, update, { detectNoop: true });
    if (!saved.ok) return saved;

    return {
      ok: true,
      value: {
        nodeId: run.value.resourceId,
        tagsAssigned: 0,
        created: saved.value.created,
      },
    };
  }
}
