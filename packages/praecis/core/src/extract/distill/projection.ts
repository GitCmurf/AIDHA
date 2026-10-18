// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { SourceType, UnitImportance, UnitKind } from './schema.js';

export const EXTRACTION_INTENTS = ['knowledge_graph', 'runbook', 'source_summary'] as const;
export type ExtractionIntent = typeof EXTRACTION_INTENTS[number];

export const GRAPH_PROJECTIONS = ['claim', 'supportingEvidence', 'procedure', 'diagnostic'] as const;
export type GraphProjection = typeof GRAPH_PROJECTIONS[number];

/**
 * Fixed routing policy for already validated model labels.
 * A route is not semantic approval or a storage operation. Runtime consumers
 * are introduced separately. Source-summary routing currently matches graph routing.
 */
export const projectUnit = (intent: ExtractionIntent, _sourceType: SourceType, kind: UnitKind, importance: UnitImportance): GraphProjection => {
  if (importance === 'incidental') return 'diagnostic';
  switch (kind) {
    case 'example':
      return 'supportingEvidence';
    case 'procedure':
      return intent === 'runbook' ? 'claim' : 'procedure';
    default:
      return 'claim';
  }
};
