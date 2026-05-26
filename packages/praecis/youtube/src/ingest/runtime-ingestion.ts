import type { GraphStore } from '@aidha/graph-backend';
import {
  createIngestionRuntime,
  type ConfiguredIngestionRuntime,
  type LlmClient,
  type PipelineServices,
  type Clock,
  runBatch,
} from '@aidha/praecis-core';
import type { Result } from '@aidha/taxonomy';
import type { TaxonomyRegistry } from '@aidha/taxonomy';
import type { ResolvedConfig } from '@aidha/config';
import type { YouTubeClient } from '../client/types.js';
import type { IngestionJob } from '../schema/index.js';
import type { IngestVideoOptions, IngestionResult, YouTubeVideoIngestResult } from '../pipeline/types.js';
import { createYouTubeVectorSpec } from './youtube-vector.js';

export interface YouTubeIngestServices {
  readonly store: GraphStore;
  readonly client: YouTubeClient;
  readonly config?: ResolvedConfig;
  readonly taxonomyRegistry?: TaxonomyRegistry;
  readonly llm?: LlmClient;
  readonly services?: Partial<PipelineServices>;
}

async function deleteStaleExcerpts(
  store: GraphStore,
  resourceId: string,
  currentExcerptIds: readonly string[],
): Promise<Result<void>> {
  const existingExcerpts = await store.queryNodes({
    type: 'Excerpt',
    filters: { resourceId },
  });
  if (!existingExcerpts.ok) return existingExcerpts;

  const keep = new Set(currentExcerptIds);
  for (const excerpt of existingExcerpts.value.items) {
    if (keep.has(excerpt.id)) continue;
    const deleted = await store.deleteNode(excerpt.id, { cascade: true });
    if (!deleted.ok) return deleted;
  }

  return { ok: true, value: undefined };
}

async function runtimeFor(input: YouTubeIngestServices): Promise<Result<ConfiguredIngestionRuntime>> {
  return createIngestionRuntime({
    ...input.services,
    store: input.store,
    ...(input.config ? { config: input.config } : {}),
    ...(input.taxonomyRegistry ? { taxonomyRegistry: input.taxonomyRegistry } : {}),
    ...(input.llm ? { llm: input.llm } : {}),
  });
}

async function ingestYouTubeVideoWithRuntime(
  runtime: ConfiguredIngestionRuntime,
  input: YouTubeIngestServices,
  videoId: string,
  options: IngestVideoOptions = {},
): Promise<Result<YouTubeVideoIngestResult>> {
  const run = await runtime.runVector(createYouTubeVectorSpec({ client: input.client }), { ref: videoId });
  if (!run.ok) return run;

  if (options.refreshTranscript) {
    const cleanup = await deleteStaleExcerpts(input.store, run.value.resourceId, run.value.excerptIds);
    if (!cleanup.ok) return cleanup;
  }

  return {
    ok: true,
    value: {
      videoId,
      nodeId: run.value.resourceId,
      classification: run.value.classification,
      created: run.value.dedupAction === 'create',
      report: run.value,
    },
  };
}

export interface PlaylistRunInput {
  readonly playlistId: string;
  readonly client: YouTubeClient;
  readonly clock?: Clock;
  runVideo(videoId: string): Promise<Result<YouTubeVideoIngestResult>>;
}

export async function runYouTubePlaylistIngestion(input: PlaylistRunInput): Promise<Result<IngestionResult>> {
  const playlist = await input.client.fetchPlaylist(input.playlistId);
  if (!playlist.ok) return playlist;

  const batch = await runBatch({
    items: playlist.value.videoIds,
    clock: input.clock ?? { now: () => new Date() },
    runItem: input.runVideo,
  });

  const job: IngestionJob = {
    id: `job-${input.playlistId}`,
    playlistId: input.playlistId,
    status: batch.outcome,
    progress: {
      total: batch.total,
      completed: batch.completed,
      failed: batch.failed,
    },
    errors: batch.failures.map(error => ({ videoId: error.item, message: error.message, timestamp: error.timestamp })),
    createdAt: batch.startedAt,
    completedAt: batch.completedAt,
  };
  const videos = batch.successes.map(success => success.value);

  return {
    ok: true,
    value: {
      job,
      videosProcessed: job.progress.completed,
      classification: batch.classification,
      nodeIds: videos.map(video => video.nodeId),
      videos,
    },
  };
}

export async function ingestYouTubeVideo(
  input: YouTubeIngestServices,
  videoId: string,
  options: IngestVideoOptions = {},
): Promise<Result<YouTubeVideoIngestResult>> {
  const runtime = await runtimeFor(input);
  if (!runtime.ok) return runtime;
  try {
    return await ingestYouTubeVideoWithRuntime(runtime.value, input, videoId, options);
  } finally {
    await runtime.value.close();
  }
}

export async function ingestYouTubePlaylist(
  input: YouTubeIngestServices,
  playlistId: string,
  options: IngestVideoOptions = {},
): Promise<Result<IngestionResult>> {
  const runtime = await runtimeFor(input);
  if (!runtime.ok) return runtime;
  try {
    return await runYouTubePlaylistIngestion({
      playlistId,
      client: input.client,
      ...(input.services?.clock ? { clock: input.services.clock } : {}),
      runVideo: videoId => ingestYouTubeVideoWithRuntime(runtime.value, input, videoId, options),
    });
  } finally {
    await runtime.value.close();
  }
}
