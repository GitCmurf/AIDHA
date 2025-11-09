/**
 * Video schema - YouTube video metadata.
 */
import { z } from 'zod';

/**
 * Video schema.
 */
export const Video = z.object({
  /** YouTube video ID */
  id: z.string().min(1),

  /** Video title */
  title: z.string().min(1),

  /** Channel ID */
  channelId: z.string().min(1),

  /** Channel name */
  channelName: z.string().min(1),

  /** Duration in seconds */
  duration: z.number().int().nonnegative(),

  /** ISO 8601 publish date */
  publishedAt: z.string().datetime(),

  /** Video description */
  description: z.string().optional(),

  /** Thumbnail URL */
  thumbnailUrl: z.string().url().optional(),
});

export type Video = z.infer<typeof Video>;

/**
 * Input for creating video record.
 */
export const CreateVideoInput = Video;

export type CreateVideoInput = z.infer<typeof CreateVideoInput>;
