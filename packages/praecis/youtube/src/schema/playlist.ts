/**
 * Playlist schema - YouTube playlist metadata.
 */
import { z } from 'zod';

/**
 * Playlist schema.
 */
export const Playlist = z.object({
  /** YouTube playlist ID */
  id: z.string().min(1),

  /** Playlist title */
  title: z.string().min(1),

  /** Channel ID */
  channelId: z.string().min(1),

  /** Channel name */
  channelName: z.string().min(1),

  /** Video IDs in the playlist */
  videoIds: z.array(z.string()),

  /** Playlist description */
  description: z.string().optional(),

  /** ISO 8601 publish date */
  publishedAt: z.string().datetime().optional(),
});

export type Playlist = z.infer<typeof Playlist>;
