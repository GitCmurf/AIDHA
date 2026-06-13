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
 * `source_summary` currently projects like `knowledge_graph` (YAGNI until a
 * summary-specific consumer exists). Note: in tranche 1, units projected to
 * `supportingEvidence`/`procedure` reach RunReport.supportingUnits as telemetry
 * only — the source synopsis is still claims-derived. Consuming supporting units
 * in the synopsis is deferred to the AIDHA-TASK-012 Task 14 synopsis rewrite.
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
