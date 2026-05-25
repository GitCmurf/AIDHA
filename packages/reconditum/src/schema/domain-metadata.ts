// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Domain metadata schemas for plan-007 multi-vector ingestion (CP-0a).
 *
 * Defines typed metadata validators for Resource, Excerpt, and Claim nodes.
 * LocatorSchema is defined inline (reconditum has no dependency on @aidha/praecis-core)
 * and mirrors the Locator discriminated union from plan-007 §3.4.
 */
import { z } from 'zod';
import { SourceType, Provenance } from './knowledge.js';

// ---------------------------------------------------------------------------
// LocatorSchema — inline copy of plan-007 §3.4 Locator discriminated union.
// Validated upstream by praecis-core; reconditum accepts the same shape here.
// ---------------------------------------------------------------------------

export const LocatorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('timecode'),
    startSec: z.number(),
    endSec: z.number(),
    speaker: z.string().optional(),
  }),
  z.object({
    kind: z.literal('page'),
    page: z.number().int(),
    charStart: z.number().int(),
    charEnd: z.number().int(),
  }),
  z.object({
    kind: z.literal('dom'),
    textFragment: z.string(),
    charStart: z.number().int(),
    charEnd: z.number().int(),
  }),
  z.object({
    kind: z.literal('message'),
    messageId: z.string(),
    charStart: z.number().int(),
    charEnd: z.number().int(),
  }),
  z.object({
    kind: z.literal('text'),
    charStart: z.number().int(),
    charEnd: z.number().int(),
  }),
  z.object({
    kind: z.literal('external'),
    system: z.string(),
    externalId: z.string(),
  }),
]);

export type LocatorSchema = z.infer<typeof LocatorSchema>;

// ---------------------------------------------------------------------------
// ResourceMetadataSchema — validates Resource node metadata
// ---------------------------------------------------------------------------

export const TaxonomyAssignmentMetadataSchema = z.object({
  nodeId: z.string(),
  tagId: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['manual', 'automatic', 'imported', 'inferred']),
  assignedAt: z.string().datetime(),
  assignedBy: z.string().optional(),
  notes: z.string().optional(),
});

export type TaxonomyAssignmentMetadataSchema = z.infer<typeof TaxonomyAssignmentMetadataSchema>;

export const ResourceMetadataSchema = z.object({
  canonicalId: z.string().optional(),
  sourceType: SourceType.optional(),
  provenances: z.array(Provenance).optional().default([]),
  dedupKeys: z.array(z.string()).optional(),
  label: z.string().optional(),
  taxonomyAssignments: z.array(TaxonomyAssignmentMetadataSchema).optional(),
}).passthrough();

export type ResourceMetadataSchema = z.infer<typeof ResourceMetadataSchema>;

// ---------------------------------------------------------------------------
// ExcerptMetadataSchema — validates Excerpt node metadata
// ---------------------------------------------------------------------------

export const ExcerptMetadataSchema = z.object({
  resourceId: z.string().optional(),
  locator: LocatorSchema.optional(),  // typed Locator (optional for backward compat in CP-0a)
  sequence: z.number().int().optional(),
  speaker: z.string().optional(),
  section: z.string().optional(),
}).passthrough();

export type ExcerptMetadataSchema = z.infer<typeof ExcerptMetadataSchema>;

// ---------------------------------------------------------------------------
// ClaimMetadataSchema — validates Claim node metadata
// ---------------------------------------------------------------------------

export const ClaimMetadataSchema = z.object({
  resourceId: z.string().optional(),
  state: z.enum(['draft', 'accepted', 'rejected']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  type: z.string().optional(),
  classification: z.string().optional(),
  domain: z.string().optional(),
  evidenceType: z.string().optional(),
  method: z.string().optional(),
}).passthrough();  // allow additional metadata fields

export type ClaimMetadataSchema = z.infer<typeof ClaimMetadataSchema>;
