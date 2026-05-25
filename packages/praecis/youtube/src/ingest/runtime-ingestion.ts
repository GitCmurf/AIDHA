import type { GraphStore } from '@aidha/graph-backend';
import {
  composeVector,
  createIngestionRuntime,
  type ConfiguredIngestionRuntime,
  type LlmClient,
  type PipelineServices,
  type ClassificationResult,
  type Clock,
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
  readonly clock?: Clock;
}

function now(clock?: Clock): string {
  return (clock?.now() ?? new Date()).toISOString();
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
  const run = await runtime.runVector(composeVector(createYouTubeVectorSpec(input.client)), { ref: videoId });
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

  const errors: IngestionJob['errors'] = [];
  const videos: YouTubeVideoIngestResult[] = [];
  let classificationStatus: ClassificationResult['status'] = 'disabled';
  const classificationWarnings: string[] = [];
  let tagsMatched = 0;
  let tagsAssigned = 0;

  for (const videoId of playlist.value.videoIds) {
    const result = await input.runVideo(videoId);
    if (result.ok) {
      videos.push(result.value);
      if (result.value.classification.status === 'completed') classificationStatus = 'completed';
      tagsMatched += result.value.classification.tagsMatched;
      tagsAssigned += result.value.classification.tagsAssigned;
      classificationWarnings.push(...result.value.classification.warnings);
    } else {
      errors.push({ videoId, message: result.error.message, timestamp: now(input.clock) });
    }
  }

  const job: IngestionJob = {
    id: `job-${input.playlistId}`,
    playlistId: input.playlistId,
    status: errors.length === playlist.value.videoIds.length && errors.length > 0 ? 'failed' : 'completed',
    progress: {
      total: playlist.value.videoIds.length,
      completed: playlist.value.videoIds.length - errors.length,
      failed: errors.length,
    },
    errors,
    createdAt: now(input.clock),
    completedAt: now(input.clock),
  };

  return {
    ok: true,
    value: {
      job,
      videosProcessed: job.progress.completed,
      classification: {
        status: classificationStatus,
        tagsMatched,
        tagsAssigned,
        warnings: Array.from(new Set(classificationWarnings)),
      },
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
      clock: input.clock ?? input.services?.clock,
      runVideo: videoId => ingestYouTubeVideoWithRuntime(runtime.value, input, videoId, options),
    });
  } finally {
    await runtime.value.close();
  }
}
