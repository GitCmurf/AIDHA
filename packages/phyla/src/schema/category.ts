/**
 * Category schema - top-level classification container.
 *
 * Categories are the broadest classification level (e.g., "Technology", "Business").
 */
import { z } from 'zod';

/**
 * Category schema.
 */
export const Category = z.object({
  /** Unique identifier */
  id: z.string().min(1),

  /** Display name */
  name: z.string().min(1),

  /** Optional description */
  description: z.string().optional(),

  /** Parent category ID for nested hierarchies */
  parentId: z.string().optional(),

  /** Sort order within parent */
  sortOrder: z.number().int().nonnegative().default(0),

  /** ISO 8601 creation timestamp */
  createdAt: z.string().datetime(),

  /** ISO 8601 last update timestamp */
  updatedAt: z.string().datetime(),
});

export type Category = z.infer<typeof Category>;

/**
 * Input for creating a category.
 */
export const CreateCategoryInput = Category.omit({
  createdAt: true,
  updatedAt: true,
});

export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

/**
 * Input for updating a category.
 */
export const UpdateCategoryInput = Category.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInput>;
