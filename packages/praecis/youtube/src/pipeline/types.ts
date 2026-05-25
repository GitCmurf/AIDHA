/**
 * Pipeline types.
 */
import type { IngestionJob } from '../schema/index.js';
import type { ClassificationResult, RunReport } from '@aidha/praecis-core';

/**
 * Result wrapper.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Ingestion result summary.
 */
export interface IngestionResult {
  /** The ingestion job record */
  job: IngestionJob;

  /** Number of videos processed */
  videosProcessed: number;

  /** Taxonomy classification status and counts */
  classification: ClassificationResult;

  /** Node IDs created */
  nodeIds: string[];

  /** Successful per-video ingestion results */
  videos: YouTubeVideoIngestResult[];
}

export interface YouTubeVideoIngestResult {
  readonly videoId: string;
  readonly nodeId: string;
  readonly classification: ClassificationResult;
  readonly created: boolean;
  readonly report: RunReport;
}

/**
 * Pipeline configuration.
 */
export interface PipelineConfig {
  graphStore: import('@aidha/graph-backend').GraphStore;
  taxonomyRegistry: import('@aidha/taxonomy').TaxonomyRegistry;
  youtubeClient: import('../client/types.js').YouTubeClient;
}

export interface IngestVideoOptions {
  refreshTranscript?: boolean;
}
