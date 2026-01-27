/**
 * Ingestion job schema - tracks ingestion progress.
 */
import { z } from 'zod';

/**
 * Job status enum.
 */
export const JobStatus = z.enum(['pending', 'running', 'completed', 'failed']);

export type JobStatus = z.infer<typeof JobStatus>;

/**
 * Job progress tracking.
 */
export const JobProgress = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export type JobProgress = z.infer<typeof JobProgress>;

/**
 * Job error record.
 */
export const JobError = z.object({
  videoId: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
});

export type JobError = z.infer<typeof JobError>;

/**
 * Ingestion job schema.
 */
export const IngestionJob = z.object({
  /** Unique job ID */
  id: z.string().min(1),

  /** Playlist being ingested */
  playlistId: z.string().min(1),

  /** Current status */
  status: JobStatus,

  /** Progress tracking */
  progress: JobProgress,

  /** Errors encountered */
  errors: z.array(JobError),

  /** ISO 8601 creation time */
  createdAt: z.string().datetime(),

  /** ISO 8601 completion time */
  completedAt: z.string().datetime().optional(),
});

export type IngestionJob = z.infer<typeof IngestionJob>;

/**
 * Input for creating a job.
 */
export const CreateJobInput = IngestionJob.omit({
  createdAt: true,
  completedAt: true,
});

export type CreateJobInput = z.infer<typeof CreateJobInput>;
