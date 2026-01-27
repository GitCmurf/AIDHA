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
