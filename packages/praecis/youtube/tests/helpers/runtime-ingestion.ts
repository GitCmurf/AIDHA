import type { GraphStore } from '@aidha/graph-backend';
import type { TaxonomyRegistry } from '@aidha/taxonomy';
import {
  type LlmClient,
  type LlmCompletionRequest,
} from '@aidha/praecis-core';
import type { YouTubeClient } from '../../src/client/types.js';
import {
  ingestYouTubePlaylist,
  ingestYouTubeVideo,
} from '../../src/ingest/runtime-ingestion.js';
import type { IngestionResult } from '../../src/pipeline/types.js';
import type { IngestVideoOptions, Result } from '../../src/pipeline/types.js';

export interface RuntimeIngestionConfig {
  graphStore: GraphStore;
  taxonomyRegistry: TaxonomyRegistry;
  youtubeClient: YouTubeClient;
}

export function createFixtureLlm(): LlmClient {
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

function fixtureConfig() {
  return {
    baseDir: process.cwd(),
    db: ':memory:',
    llm: {
      model: 'test-llm',
      apiKey: '',
      baseUrl: '',
      timeoutMs: 30_000,
      cacheDir: './out/cache/claims',
      reasoningEffort: 'medium' as const,
      verbosity: 'medium' as const,
      embeddingBatchSize: 20,
      embeddingTaskType: 'SEMANTIC_SIMILARITY' as const,
      embeddingOutputDimensionality: 768,
    },
    editor: {
      version: 'v2' as const,
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
  };
}

export class RuntimeIngestionHarness {
  constructor(private readonly config: RuntimeIngestionConfig) {}

  async ingestPlaylist(playlistId: string): Promise<Result<IngestionResult>> {
    return ingestYouTubePlaylist({
      store: this.config.graphStore,
      client: this.config.youtubeClient,
      taxonomyRegistry: this.config.taxonomyRegistry,
      config: fixtureConfig(),
      llm: createFixtureLlm(),
    }, playlistId);
  }

  async ingestVideo(
    videoId: string,
    options: IngestVideoOptions = {},
  ): Promise<Result<{ nodeId: string; classification: import('@aidha/praecis-core').ClassificationResult; created: boolean }>> {
    const result = await ingestYouTubeVideo({
      store: this.config.graphStore,
      client: this.config.youtubeClient,
      taxonomyRegistry: this.config.taxonomyRegistry,
      config: fixtureConfig(),
      llm: createFixtureLlm(),
    }, videoId, options);
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        nodeId: result.value.nodeId,
        classification: result.value.classification,
        created: result.value.created,
      },
    };
  }
}
