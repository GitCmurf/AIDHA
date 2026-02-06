/**
 * Tag schema - leaf-level classification label.
 *
 * Tags are applied to knowledge nodes and can span multiple topics.
 */
import { z } from 'zod';

/**
 * Tag schema.
 */
export const Tag = z.object({
  /** Unique identifier */
  id: z.string().min(1),

  /** Canonical name */
  name: z.string().min(1),

  /** Topic IDs this tag belongs to */
  topicIds: z.array(z.string()).min(1),

  /** Alternative names/spellings for matching */
  aliases: z.array(z.string()).default([]),

  /** Optional description */
  description: z.string().optional(),

  /** Color for UI display (hex) */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),

  /** ISO 8601 creation timestamp */
  createdAt: z.string().datetime(),

  /** ISO 8601 last update timestamp */
  updatedAt: z.string().datetime(),
});

export type Tag = z.infer<typeof Tag>;

/**
 * Input for creating a tag.
 */
export const CreateTagInput = Tag.omit({
  createdAt: true,
  updatedAt: true,
});

export type CreateTagInput = z.input<typeof CreateTagInput>;

/**
 * Input for updating a tag.
 */
export const UpdateTagInput = Tag.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UpdateTagInput = z.infer<typeof UpdateTagInput>;
