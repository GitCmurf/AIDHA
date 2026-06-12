// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { DraftClaim } from '../../interfaces/index.js';
import type { ConsolidatedUnit, UnitRelation } from './consolidation.js';
import type { CoverageDiagnostics } from './coverage.js';
import type { RejectedUnit } from './grounding.js';
import type { SourceCoherence, SourceType, UnitKind } from './schema.js';
import { projectUnit, type ExtractionIntent } from './projection.js';

export interface SupportingUnitReport {
  readonly id: string;
  readonly kind: UnitKind;
  readonly text: string;
  readonly supportsUnitIds: readonly string[];
  readonly excerptIds: readonly string[];
}

export interface SourceDistillationReport {
  readonly sourceType: SourceType;
  readonly sourcePurpose?: string;
  readonly sourceCoherence: SourceCoherence;
  readonly theses: readonly string[];
  readonly coverage: CoverageDiagnostics;
  readonly unitCountsByKind: Readonly<Record<string, number>>;
  readonly relations: readonly UnitRelation[];
  readonly diagnostics: readonly string[];
}

export interface DistillationOutputInput {
  readonly extractionIntent: ExtractionIntent;
  readonly sourceType: SourceType;
  readonly sourcePurpose?: string;
  readonly sourceCoherence: SourceCoherence;
  readonly theses: readonly string[];
  readonly units: readonly ConsolidatedUnit[];
  readonly rejectedUnits: readonly RejectedUnit[];
  readonly recordedRelations: readonly UnitRelation[];
  readonly coverage: CoverageDiagnostics;
  readonly diagnostics: readonly string[];
  readonly model: string;
  readonly promptVersion: string;
}

export interface DistillationOutput {
  readonly claims: readonly DraftClaim[];
  readonly rejectedClaims: readonly DraftClaim[];
  readonly supportingUnits: readonly SupportingUnitReport[];
  readonly distillation: SourceDistillationReport;
}

const KIND_TO_CLAIM_TYPE: Record<UnitKind, string> = {
  idea: 'insight',
  mechanism: 'mechanism',
  fact: 'fact',
  recommendation: 'recommendation',
  limitation: 'warning',
  example: 'example',
  procedure: 'instruction',
};

function excerptIdsOf(unit: ConsolidatedUnit): string[] {
  return [...new Set(unit.evidence.map(ref => ref.excerptId))];
}

function unitToDraftClaim(
  unit: ConsolidatedUnit | RejectedUnit['unit'],
  input: DistillationOutputInput,
  qualityStatus: 'reviewable' | 'rejected',
  rejectionReason?: string
): DraftClaim {
  return {
    text: unit.text,
    excerptIds: excerptIdsOf(unit as ConsolidatedUnit),
    state: 'draft',
    type: KIND_TO_CLAIM_TYPE[unit.kind],
    classification: KIND_TO_CLAIM_TYPE[unit.kind],
    metadata: {
      method: 'llm-distill',
      model: input.model,
      promptVersion: input.promptVersion,
      unitId: unit.id,
      unitKind: unit.kind,
      stance: unit.stance,
      importance: unit.importance,
      trusted: false,
      qualityStatus,
      evidence: unit.evidence,
      ...(rejectionReason ? { rejectionReason } : {}),
      ...(unit.rationale ? { rationale: unit.rationale } : {}),
      ...(unit.conditions && unit.conditions.length > 0 ? { conditions: unit.conditions } : {}),
      ...(unit.attribution ? { attribution: unit.attribution } : {}),
      ...('supportsUnitIds' in unit && unit.supportsUnitIds && unit.supportsUnitIds.length > 0 ? { supportsUnitIds: unit.supportsUnitIds } : {}),
      ...('mergedFromUnitIds' in unit && unit.mergedFromUnitIds && unit.mergedFromUnitIds.length > 0 ? { mergedFromUnitIds: unit.mergedFromUnitIds } : {}),
    },
  };
}

export function buildDistillationOutput(input: DistillationOutputInput): DistillationOutput {
  const claims: DraftClaim[] = [];
  const supportingUnits: SupportingUnitReport[] = [];
  const diagnostics: string[] = [...input.diagnostics];
  const unitCountsByKind: Record<string, number> = {};

  for (const unit of input.units) {
    unitCountsByKind[unit.kind] = (unitCountsByKind[unit.kind] ?? 0) + 1;
    const projection = projectUnit(input.extractionIntent, input.sourceType, unit.kind, unit.importance);
    switch (projection) {
      case 'claim':
        claims.push(unitToDraftClaim(unit, input, 'reviewable'));
        break;
      case 'supportingEvidence':
      case 'procedure':
        supportingUnits.push({
          id: unit.id,
          kind: unit.kind,
          text: unit.text,
          supportsUnitIds: unit.supportsUnitIds ?? [],
          excerptIds: excerptIdsOf(unit),
        });
        break;
      case 'diagnostic':
        diagnostics.push(`Unit ${unit.id} (${unit.kind}, ${unit.importance}) projected to diagnostic.`);
        break;
    }
  }

  if (input.theses.length === 0) {
    diagnostics.push('Distillation produced no thesis; review whether the source genuinely lacks one.');
  }
  if (input.sourcePurpose === undefined) {
    diagnostics.push('Distillation produced no sourcePurpose.');
  }

  const rejectedClaims = input.rejectedUnits.map(rejectedUnit =>
    unitToDraftClaim(rejectedUnit.unit, input, 'rejected', rejectedUnit.reason)
  );

  return {
    claims,
    rejectedClaims,
    supportingUnits,
    distillation: {
      sourceType: input.sourceType,
      ...(input.sourcePurpose ? { sourcePurpose: input.sourcePurpose } : {}),
      sourceCoherence: input.sourceCoherence,
      theses: input.theses,
      coverage: input.coverage,
      unitCountsByKind,
      relations: input.recordedRelations,
      diagnostics,
    },
  };
}
