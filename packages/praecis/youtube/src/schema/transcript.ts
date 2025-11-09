/**
 * Transcript schema - YouTube video transcript.
 */
import { z } from 'zod';

/**
 * Transcript segment schema.
 */
export const TranscriptSegment = z.object({
  /** Start time in seconds */
  start: z.number().nonnegative(),

  /** Duration in seconds */
  duration: z.number().nonnegative(),

  /** Segment text */
  text: z.string(),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

/**
 * Full transcript schema.
 */
export const Transcript = z.object({
  /** Video ID */
  videoId: z.string().min(1),

  /** Language code */
  language: z.string().min(2),

  /** Transcript segments */
  segments: z.array(TranscriptSegment).min(1),

  /** Concatenated full text */
  fullText: z.string(),
});

export type Transcript = z.infer<typeof Transcript>;
