/**
 * @aidha/ingestion-youtube
 *
 * YouTube playlist ingestion with transcript capture and classification.
 */

// Schema exports
export {
  Video,
  CreateVideoInput,
  Playlist,
  TranscriptSegment,
  Transcript,
  JobStatus,
  JobProgress,
  JobError,
  IngestionJob,
  CreateJobInput,
} from './schema/index.js';

// Config exports
export * from './config/index.js';

// Client exports
export type { YouTubeClient } from './client/index.js';
export { MockYouTubeClient, RealYouTubeClient } from './client/index.js';

// Source-neutral ingest adapter
export { createYouTubeVectorSpec, ingestYouTubePlaylist, ingestYouTubeVideo, runYouTubePlaylistIngestion } from './ingest/index.js';

// Pipeline status exports
export type { PipelineConfig, IngestionResult, YouTubeVideoIngestResult } from './pipeline/index.js';

// Export (Markdown dossier)
export type {
  DossierClaim,
  VideoDossier,
  PlaylistDossier,
  PlaylistDossierInput,
  TranscriptSegmentExport,
  TranscriptExport,
  PlaylistTranscriptExport,
} from './export/index.js';
export { DossierExporter } from './export/index.js';

// Retrieval exports
export type { SearchOptions, ClaimSearchHit } from './retrieve/index.js';
export type { RelatedClaimsOptions, RelatedClaimHit } from './retrieve/index.js';
export { searchClaims, findRelatedClaims } from './retrieve/index.js';

// Review queue exports
export type {
  ReviewQueueOptions,
  ReviewQueueItem,
  ReviewActionInput,
  ReviewActionResult,
} from './review/index.js';
export { getReviewQueue, applyReviewAction } from './review/index.js';

// Diagnostic exports
export type { TranscriptDiagnosis, ExtractionDiagnosis, EditorialDiagnosis } from './diagnose/index.js';
export {
  diagnoseTranscript,
  diagnoseExtraction,
  formatTranscriptDiagnosis,
  formatExtractionDiagnosis,
} from './diagnose/index.js';

// Task exports
export type {
  TaskCreateInput,
  TaskCreateResult,
  StandaloneTaskCreateInput,
  TaskContext,
  TaskClaimContext,
} from './tasks/index.js';
export {
  createTaskFromClaim,
  createTaskStandalone,
  getTaskContext,
  formatTaskContext,
  normalizeProjectIdForCli,
} from './tasks/index.js';

// Planning exports
export type {
  AreaCreateInput,
  AreaCreateResult,
  GoalCreateInput,
  GoalCreateResult,
  ProjectCreateInput,
  ProjectCreateResult,
} from './planning/index.js';
export { createArea, createGoal, createProject } from './planning/index.js';

// Utility exports
export type { Logger, BufferedLogEntry } from './utils/logger.js';
export { consoleLogger, silentLogger, BufferedLogger } from './utils/logger.js';
