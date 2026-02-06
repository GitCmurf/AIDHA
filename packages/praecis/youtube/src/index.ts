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

// Client exports
export type { YouTubeClient } from './client/index.js';
export { MockYouTubeClient, RealYouTubeClient } from './client/index.js';


// Pipeline exports
export type { PipelineConfig, IngestionResult } from './pipeline/index.js';
export { IngestionPipeline } from './pipeline/index.js';

// Extraction exports
export type {
  ClaimCandidate,
  ClaimExtractionInput,
  ClaimExtractionResult,
  ReferenceExtractionResult,
} from './extract/index.js';
export type { LlmClient, LlmCompletionRequest } from './extract/index.js';
export {
  ClaimExtractionPipeline,
  HeuristicClaimExtractor,
  LlmClaimExtractor,
  OpenAiCompatibleClient,
  createDefaultLlmClient,
  ReferenceExtractionPipeline,
} from './extract/index.js';

// Export (Markdown dossier)
export type { DossierClaim, VideoDossier, PlaylistDossier, PlaylistDossierInput } from './export/index.js';
export { DossierExporter } from './export/index.js';

// Retrieval exports
export type { SearchOptions, ClaimSearchHit } from './retrieve/index.js';
export { searchClaims } from './retrieve/index.js';

// Task exports
export type { TaskCreateInput, TaskCreateResult, TaskContext, TaskClaimContext } from './tasks/index.js';
export { createTaskFromClaim, getTaskContext, formatTaskContext, normalizeProjectIdForCli } from './tasks/index.js';
