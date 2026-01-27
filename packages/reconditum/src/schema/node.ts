/**
 * GraphNode schema - base entity for all nodes in the knowledge graph.
 */
import { z } from 'zod';

/**
 * Node types supported in the knowledge graph.
 */
export const NodeType = z.enum([
  'Knowledge',    // General knowledge entity
  'Concept',      // Abstract concept
  'Resource',     // External resource (URL, file, etc.)
  'Person',       // Person entity
  'Topic',        // Topic/category
]);

export type NodeType = z.infer<typeof NodeType>;

/**
 * Schema for node metadata - extensible key-value pairs.
 */
export const NodeMetadata = z.record(z.string(), z.unknown());

export type NodeMetadata = z.infer<typeof NodeMetadata>;

/**
 * GraphNode schema - the fundamental vertex in our graph.
 */
export const GraphNode = z.object({
  /** Unique identifier for the node */
  id: z.string().min(1),

  /** Type categorization */
  type: NodeType,

  /** Human-readable display label */
  label: z.string().min(1),

  /** Optional description or content */
  content: z.string().optional(),

  /** Extensible metadata */
  metadata: NodeMetadata.default({}),

  /** ISO 8601 creation timestamp */
  createdAt: z.string().datetime(),

  /** ISO 8601 last update timestamp */
  updatedAt: z.string().datetime(),
});

export type GraphNode = z.infer<typeof GraphNode>;

/**
 * Input schema for creating a new node (auto-generates timestamps).
 */
export const CreateNodeInput = GraphNode.omit({
  createdAt: true,
  updatedAt: true,
});

export type CreateNodeInput = z.infer<typeof CreateNodeInput>;

/**
 * Input schema for updating a node (partial, auto-updates timestamp).
 */
export const UpdateNodeInput = GraphNode.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UpdateNodeInput = z.infer<typeof UpdateNodeInput>;
