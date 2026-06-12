// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { SourceType, UnitImportance, UnitKind } from './schema.js';

export const EXTRACTION_INTENTS = ['knowledge_graph', 'runbook', 'source_summary'] as const;
export type ExtractionIntent = typeof EXTRACTION_INTENTS[number];

export const GRAPH_PROJECTIONS = ['claim', 'supportingEvidence', 'procedure', 'diagnostic'] as const;
export type GraphProjection = typeof GRAPH_PROJECTIONS[number];

/**
 * Deterministic projection policy per AIDHA-PLAN-010.
 * Deliberately NOT model-emitted: self-graded projection invites rubber-stamping.
 * `source_summary` currently projects like `knowledge_graph`; the synopsis already
 * includes all units, so no special-casing is needed yet (YAGNI).
 */
export function projectUnit(
  intent: ExtractionIntent,
  _sourceType: SourceType,
  kind: UnitKind,
  importance: UnitImportance
): GraphProjection {
  if (importance === 'incidental') return 'diagnostic';
  switch (kind) {
    case 'example':
      return 'supportingEvidence';
    case 'procedure':
      return intent === 'runbook' ? 'claim' : 'procedure';
    default:
      return 'claim';
  }
}
