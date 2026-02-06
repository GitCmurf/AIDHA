/**
 * TagAssignment schema - links tags to knowledge nodes.
 *
 * Records which tags are applied to which nodes, with confidence and source.
 */
import { z } from 'zod';

/**
 * Source of the tag assignment.
 */
export const AssignmentSource = z.enum([
  'manual',     // Human-assigned
  'automatic',  // AI/rule-based
  'imported',   // From external system
  'inferred',   // Derived from relationships
]);

export type AssignmentSource = z.infer<typeof AssignmentSource>;

/**
 * TagAssignment schema.
 */
export const TagAssignment = z.object({
  /** Node ID being tagged */
  nodeId: z.string().min(1),

  /** Tag ID being applied */
  tagId: z.string().min(1),

  /** Confidence score (0-1) */
  confidence: z.number().min(0).max(1).default(1),

  /** How the tag was assigned */
  source: AssignmentSource.default('manual'),

  /** Optional notes about the assignment */
  notes: z.string().optional(),

  /** Who/what made the assignment */
  assignedBy: z.string().optional(),

  /** ISO 8601 assignment timestamp */
  assignedAt: z.string().datetime(),
});

export type TagAssignment = z.infer<typeof TagAssignment>;

/**
 * Input for creating a tag assignment.
 */
export const CreateAssignmentInput = TagAssignment.omit({
  assignedAt: true,
});

export type CreateAssignmentInput = z.input<typeof CreateAssignmentInput>;
