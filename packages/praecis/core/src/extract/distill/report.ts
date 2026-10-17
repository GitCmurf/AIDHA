// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { DraftClaim, SegmentRepairRecord, SourceLimitationSummary, SupportingUnitSummary } from '../../interfaces/index.js';
import type { CoverageDiagnostics } from './coverage.js';
import type { RejectedUnit } from './grounding.js';
import { projectUnit, type ExtractionIntent } from './projection.js';
import type { VerifiedUnit } from './quote-verification.js';
import type { SourceCoherence, SourceType, UnitKind } from './schema.js';

export interface SupportingUnitReport extends SupportingUnitSummary {
  readonly kind: UnitKind;
}

export interface SourceDistillationReport {
  readonly sourceType: SourceType;
  readonly sourcePurpose?: string;
  readonly sourceCoherence: SourceCoherence;
  readonly theses: readonly string[];
  readonly coverage: CoverageDiagnostics;
  readonly unitCountsByKind: Readonly<Record<string, number>>;
  readonly diagnostics: readonly string[];
  readonly segmentRepairs?: readonly SegmentRepairRecord[];
}

export interface DistillationOutputInput {
  readonly extractionIntent: ExtractionIntent;
  readonly sourceType: SourceType;
  readonly sourcePurpose?: string;
  readonly sourceCoherence: SourceCoherence;
  readonly theses: readonly string[];
  readonly units: readonly VerifiedUnit[];
  readonly rejectedUnits: readonly RejectedUnit[];
  readonly limitationsByTarget?: ReadonlyMap<string, readonly SourceLimitationSummary[]>;
  readonly coverage: CoverageDiagnostics;
  readonly diagnostics: readonly string[];
  readonly segmentRepairs?: readonly SegmentRepairRecord[];
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
  idea: 'insight', mechanism: 'mechanism', fact: 'fact', recommendation: 'recommendation',
  limitation: 'warning', example: 'example', procedure: 'instruction',
};

const excerptIdsOf = (unit: VerifiedUnit): string[] => [...new Set(unit.evidence.map(ref => ref.excerptId))];

const unitToDraftClaim = (
  unit: VerifiedUnit,
  input: DistillationOutputInput,
  qualityStatus: 'reviewable' | 'rejected',
  rejectionReason?: RejectedUnit['reason'],
  unresolvedSupportsUnitIds: readonly string[] = [],
  limitations: readonly SourceLimitationSummary[] = [],
): DraftClaim => ({
  text: unit.text,
  excerptIds: excerptIdsOf(unit),
  state: 'draft',
  type: KIND_TO_CLAIM_TYPE[unit.kind],
  classification: KIND_TO_CLAIM_TYPE[unit.kind],
  metadata: {
    method: 'llm-distill', model: input.model, promptVersion: input.promptVersion,
    unitId: unit.id, unitKind: unit.kind, stance: unit.stance, importance: unit.importance,
    trusted: false, qualityStatus, evidence: unit.evidence,
    ...(rejectionReason ? { rejectionReason } : {}),
    ...(unit.rationale ? { rationale: unit.rationale } : {}),
    ...(unit.conditions?.length ? { conditions: unit.conditions } : {}),
    ...(unit.attribution ? { attribution: unit.attribution } : {}),
    ...(unit.supportsUnitIds?.length ? { supportsUnitIds: unit.supportsUnitIds } : {}),
    ...(unresolvedSupportsUnitIds.length ? { unresolvedSupportsUnitIds } : {}),
    ...(limitations.length ? { limitations } : {}),
  },
});

/** Routing preserves proposed meaning and evidence; it never establishes trust. */
export const buildDistillationOutput = (input: DistillationOutputInput): DistillationOutput => {
  const claims: DraftClaim[] = [];
  const supportingUnits: SupportingUnitReport[] = [];
  const diagnostics = [...input.diagnostics];
  const unitCountsByKind: Record<string, number> = {};
  const emittedIds = new Set(input.units.filter(unit =>
    projectUnit(input.extractionIntent, input.sourceType, unit.kind, unit.importance) !== 'diagnostic').map(unit => unit.id));
  for (const original of input.units) {
    const unresolvedSupportsUnitIds = (original.supportsUnitIds ?? []).filter(id => !emittedIds.has(id));
    const unit = { ...original, supportsUnitIds: (original.supportsUnitIds ?? []).filter(id => emittedIds.has(id)) };
    if (unresolvedSupportsUnitIds.length) diagnostics.push(`Unit ${unit.id} has unresolved source-proposed support targets (not live relationships): ${unresolvedSupportsUnitIds.join(', ')}.`);
    unitCountsByKind[unit.kind] = (unitCountsByKind[unit.kind] ?? 0) + 1;
    const projection = projectUnit(input.extractionIntent, input.sourceType, unit.kind, unit.importance);
    switch (projection) {
      case 'claim':
        claims.push(unitToDraftClaim(unit, input, 'reviewable', undefined, unresolvedSupportsUnitIds,
          input.limitationsByTarget?.get(unit.id) ?? []));
        break;
      case 'supportingEvidence':
      case 'procedure':
        supportingUnits.push({
          id: unit.id, kind: unit.kind, text: unit.text,
          supportsUnitIds: unit.supportsUnitIds ?? [],
          ...(unresolvedSupportsUnitIds.length ? { unresolvedSupportsUnitIds } : {}),
          excerptIds: excerptIdsOf(unit),
          evidence: unit.evidence, stance: unit.stance, importance: unit.importance,
          ...(unit.rationale ? { rationale: unit.rationale } : {}),
          ...(unit.conditions ? { conditions: unit.conditions } : {}),
          ...(unit.attribution ? { attribution: unit.attribution } : {}),
        });
        break;
      case 'diagnostic':
        diagnostics.push(`Unit ${unit.id} (${unit.kind}, ${unit.importance}) projected to diagnostic.`);
        break;
      default:
        throw new Error(`Unsupported projection: ${projection satisfies never}`);
    }
  }
  if (input.theses.length === 0) diagnostics.push('Distillation produced no thesis; review whether the source genuinely lacks one.');
  if (input.sourcePurpose === undefined) diagnostics.push('Distillation produced no sourcePurpose.');

  return {
    claims,
    rejectedClaims: input.rejectedUnits.map(({ unit, reason }) => unitToDraftClaim(unit, input, 'rejected', reason)),
    supportingUnits,
    distillation: {
      sourceType: input.sourceType,
      ...(input.sourcePurpose ? { sourcePurpose: input.sourcePurpose } : {}),
      sourceCoherence: input.sourceCoherence, theses: input.theses, coverage: input.coverage,
      unitCountsByKind, diagnostics,
      ...(input.segmentRepairs?.length ? { segmentRepairs: input.segmentRepairs } : {}),
    },
  };
};
