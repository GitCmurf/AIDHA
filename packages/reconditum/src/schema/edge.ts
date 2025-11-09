// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * GraphEdge schema - represents relationships between nodes.
 *
 * Uses RDF-style subject-predicate-object triple structure.
 */
import { z } from 'zod';

/**
 * Predicate types for edges (relationship semantics).
 */
export const Predicate = z.enum([
  'relatedTo',      // General relationship
  'partOf',         // Hierarchical containment
  'references',     // Points to external resource
  'derivedFrom',    // Provenance/source
  'createdBy',      // Authorship
  'taggedWith',     // Topic tagging
  'supersedes',     // Version relationship
  'resourceHasExcerpt',
  'claimDerivedFrom',
  'claimMentionsReference',
  'aboutTag',
  'taskMotivatedBy',
  'taskPartOfProject',
  'projectServesGoal',
  'projectInArea',
  'taskDependsOn',
]);

export type Predicate = z.infer<typeof Predicate>;

/**
 * Edge metadata - extensible properties on relationships.
 */
export const EdgeMetadata = z.record(z.string(), z.unknown());

export type EdgeMetadata = z.infer<typeof EdgeMetadata>;

/**
 * GraphEdge schema - the fundamental edge in our graph.
 *
 * Follows RDF triple pattern: (subject) --[predicate]--> (object)
 */
export const GraphEdge = z.object({
  /** Subject node ID (source of the relationship) */
  subject: z.string().min(1),

  /** Predicate (type of relationship) */
  predicate: Predicate,

  /** Object node ID (target of the relationship) */
  object: z.string().min(1),

  /** Extensible metadata on the edge */
  metadata: EdgeMetadata.default({}),

  /** ISO 8601 creation timestamp */
  createdAt: z.string().datetime(),
});

export type GraphEdge = z.infer<typeof GraphEdge>;

/**
 * Input schema for creating a new edge (auto-generates timestamp).
 */
export const CreateEdgeInput = GraphEdge.omit({
  createdAt: true,
});

export type CreateEdgeInput = z.infer<typeof CreateEdgeInput>;

/**
 * Triple representation for LevelGraph storage.
 * Maps our domain model to LevelGraph's triple format.
 */
export interface LevelGraphTriple {
  subject: string;
  predicate: string;
  object: string;
  [key: string]: unknown;
}
