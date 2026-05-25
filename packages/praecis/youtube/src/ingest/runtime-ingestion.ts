import type { GraphStore } from '@aidha/graph-backend';
import {
  composeVector,
  createPipelineRuntime,
  type LlmClient,
  type PipelineServices,
  type RunReport,
} from '@aidha/praecis-core';
import type { Result } from '@aidha/taxonomy';
import type { TaxonomyRegistry } from '@aidha/taxonomy';
import type { ResolvedConfig } from '@aidha/config';
import type { YouTubeClient } from '../client/types.js';
import type { IngestionJob } from '../schema/index.js';
import type { IngestVideoOptions, IngestionResult } from '../pipeline/types.js';
import { createYouTubeVectorSpec } from './youtube-vector.js';

export interface YouTubeIngestServices {
  readonly store: GraphStore;
  readonly client: YouTubeClient;
  readonly config?: ResolvedConfig;
  readonly taxonomyRegistry?: TaxonomyRegistry;
  readonly llm?: LlmClient;
  readonly services?: Partial<PipelineServices>;
}

export interface YouTubeVideoIngestResult {
  readonly nodeId: string;
  readonly tagsAssigned: number;
  readonly created: boolean;
  readonly report: RunReport;
}

function now(): string {
  return new Date().toISOString();
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

function runtimeFor(input: YouTubeIngestServices) {
  const runtime = createPipelineRuntime({
    ...input.services,
    store: input.store,
    ...(input.config ? { config: input.config } : {}),
    ...(input.taxonomyRegistry ? { taxonomyRegistry: input.taxonomyRegistry } : {}),
    ...(input.llm ? { llm: input.llm } : {}),
  });
  runtime.register(composeVector(createYouTubeVectorSpec(input.client)));
  return runtime;
}

export async function ingestYouTubeVideo(
  input: YouTubeIngestServices,
  videoId: string,
  options: IngestVideoOptions = {},
): Promise<Result<YouTubeVideoIngestResult>> {
  const runtime = runtimeFor(input);
  const run = await runtime.run('youtube', { ref: videoId });
  if (!run.ok) return run;

  if (options.refreshTranscript) {
    const cleanup = await deleteStaleExcerpts(input.store, run.value.resourceId, run.value.excerptIds);
    if (!cleanup.ok) return cleanup;
  }

  return {
    ok: true,
    value: {
      nodeId: run.value.resourceId,
      tagsAssigned: run.value.classification.tagsAssigned,
      created: run.value.dedupAction === 'create',
      report: run.value,
    },
  };
}

export async function ingestYouTubePlaylist(
  input: YouTubeIngestServices,
  playlistId: string,
  options: IngestVideoOptions = {},
): Promise<Result<IngestionResult>> {
  const playlist = await input.client.fetchPlaylist(playlistId);
  if (!playlist.ok) return playlist;

  const errors: IngestionJob['errors'] = [];
  const nodeIds: string[] = [];
  let tagsAssigned = 0;
  for (const videoId of playlist.value.videoIds) {
    const result = await ingestYouTubeVideo(input, videoId, options);
    if (result.ok) {
      nodeIds.push(result.value.nodeId);
      tagsAssigned += result.value.tagsAssigned;
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
      tagsAssigned,
      nodeIds,
    },
  };
}
