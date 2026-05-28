// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Knowledge entity schema - specialized node for knowledge items.
 *
 * Extends the base GraphNode with knowledge-specific fields.
 */
import { z } from 'zod';
import { GraphNode, NodeMetadata } from './node.js';

/**
 * Source type for knowledge provenance.
 */
export const SourceType = z.enum([
  'youtube',    // YouTube video/transcript
  'web',        // Web page (crawled/fetched)
  'pdf',        // PDF document
  'document',   // Office/plain-text document
  'rss',        // RSS/Atom feed item
  'podcast',    // Podcast episode
  'voice',      // Voice memo / dictation
  'meeting',    // Meeting recording / transcript
  'readwise',   // Readwise highlight
  'email',      // Email message
  'linkedin',   // LinkedIn post / profile
  'article',    // Web article (legacy alias)
  'book',       // Book/publication
  'note',       // Personal note
  'import',     // Imported from external system
  'generated',  // AI-generated content
]);

export type SourceType = z.infer<typeof SourceType>;

/**
 * Provenance information for knowledge items.
 */
export const Provenance = z.object({
  /** Source type */
  sourceType: SourceType,

  /** Original source URL or identifier */
  sourceUri: z.string().optional(),

  /** When the content was ingested */
  ingestedAt: z.string().datetime(),

  /** Processing pipeline version */
  pipelineVersion: z.string().optional(),
});

export type Provenance = z.infer<typeof Provenance>;

/**
 * Knowledge metadata extends base metadata with provenance.
 */
export const KnowledgeMetadata = NodeMetadata.and(
  z.object({
    provenances: z.array(Provenance).optional().default([]),
    confidence: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
  })
);

export type KnowledgeMetadata = z.infer<typeof KnowledgeMetadata>;

/**
 * Knowledge entity - a node specialized for knowledge storage.
 */
export const Knowledge = GraphNode.extend({
  type: z.literal('Knowledge'),
  metadata: KnowledgeMetadata.default(() => ({ provenances: [] })),
});

export type Knowledge = z.infer<typeof Knowledge>;

/**
 * Input schema for creating knowledge entities.
 */
export const CreateKnowledgeInput = Knowledge.omit({
  schemaVersion: true,
  createdAt: true,
  updatedAt: true,
}).strict();

export type CreateKnowledgeInput = z.infer<typeof CreateKnowledgeInput>;
