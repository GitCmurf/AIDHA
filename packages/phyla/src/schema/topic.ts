/**
 * Topic schema - mid-level classification within a category.
 *
 * Topics belong to categories and group related tags (e.g., "TypeScript" under "Technology").
 */
import { z } from 'zod';

/**
 * Topic schema.
 */
export const Topic = z.object({
  /** Unique identifier */
  id: z.string().min(1),

  /** Display name */
  name: z.string().min(1),

  /** Parent category ID */
  categoryId: z.string().min(1),

  /** Optional description */
  description: z.string().optional(),

  /** Keywords for search/matching */
  keywords: z.array(z.string()).default([]),

  /** Sort order within category */
  sortOrder: z.number().int().nonnegative().default(0),

  /** ISO 8601 creation timestamp */
  createdAt: z.string().datetime(),

  /** ISO 8601 last update timestamp */
  updatedAt: z.string().datetime(),
});

export type Topic = z.infer<typeof Topic>;

/**
 * Input for creating a topic.
 */
export const CreateTopicInput = Topic.omit({
  createdAt: true,
  updatedAt: true,
}).partial({
  keywords: true,
  sortOrder: true,
});

export type CreateTopicInput = z.input<typeof CreateTopicInput>;

/**
 * Input for updating a topic.
 */
export const UpdateTopicInput = Topic.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UpdateTopicInput = z.infer<typeof UpdateTopicInput>;
