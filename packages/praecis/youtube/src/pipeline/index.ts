/**
 * Pipeline module - exports pipeline types and implementation.
 */
export type { PipelineConfig, IngestionResult, Result } from './types.js';
export type { IngestionStatus } from './status.js';
export { IngestionPipeline } from './ingest.js';
export { getIngestionStatus } from './status.js';
