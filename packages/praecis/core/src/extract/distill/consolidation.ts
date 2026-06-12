// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { z } from 'zod';
import { extractJsonObject } from './json.js';
import type { VerifiedUnit } from './quote-verification.js';
import type { ConditionType } from './schema.js';

export const RELATION_TYPES = ['merged_duplicate', 'supports', 'example_of', 'refines', 'limits', 'contrasts'] as const;

const RelationSchema = z.object({
  type: z.enum(RELATION_TYPES),
  sourceUnitId: z.string().min(1),
  targetUnitId: z.string().min(1),
});

const ConsolidationResponseSchema = z.object({
  relations: z.array(RelationSchema),
});

export type UnitRelation = z.infer<typeof RelationSchema>;

export type ConsolidatedUnit = VerifiedUnit & { readonly mergedFromUnitIds?: readonly string[] };

export type ParseRelationsResult =
  | { readonly ok: true; readonly value: readonly UnitRelation[] }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface ConsolidationResult {
  readonly units: readonly ConsolidatedUnit[];
  /** All valid relations, including refines/contrasts which have no pipeline behavior yet. */
  readonly recordedRelations: readonly UnitRelation[];
  readonly diagnostics: readonly string[];
}

export function parseConsolidationRelations(raw: string): ParseRelationsResult {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, errors: ['Consolidation response contains no JSON object.'] };
  try {
    const parsed = ConsolidationResponseSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
    }
    return { ok: true, value: parsed.data.relations };
  } catch (error) {
    return { ok: false, errors: [`Consolidation response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/**
 * Applies consolidation relations per AIDHA-PLAN-010: only merged_duplicate,
 * supports/example_of, and limits have pipeline behavior; refines/contrasts
 * are recorded for the graph layer.
 */
export function applyConsolidation(
  units: readonly VerifiedUnit[],
  relations: readonly UnitRelation[]
): ConsolidationResult {
  const diagnostics: string[] = [];
  const byId = new Map<string, ConsolidatedUnit>(units.map(unit => [unit.id, unit]));
  const recordedRelations: UnitRelation[] = [];

  for (const relation of relations) {
    const source = byId.get(relation.sourceUnitId);
    const target = byId.get(relation.targetUnitId);
    if (!source || !target || relation.sourceUnitId === relation.targetUnitId) {
      diagnostics.push(`Relation ${relation.type} ${relation.sourceUnitId}->${relation.targetUnitId} references unknown or identical units; ignored.`);
      continue;
    }
    recordedRelations.push(relation);

    switch (relation.type) {
      case 'merged_duplicate': {
        const seenEvidence = new Set(target.evidence.map(ref => `${ref.excerptId}::${ref.quote}`));
        const mergedEvidence = [
          ...target.evidence,
          ...source.evidence.filter(ref => !seenEvidence.has(`${ref.excerptId}::${ref.quote}`)),
        ];
        byId.set(target.id, {
          ...target,
          evidence: mergedEvidence,
          mergedFromUnitIds: [...(target.mergedFromUnitIds ?? []), source.id],
        });
        byId.delete(source.id);
        break;
      }
      case 'supports':
      case 'example_of': {
        const existing = new Set(source.supportsUnitIds ?? []);
        existing.add(target.id);
        byId.set(source.id, { ...source, supportsUnitIds: [...existing] });
        break;
      }
      case 'limits': {
        const foldedType: ConditionType = source.conditions?.[0]?.type ?? 'assumption';
        const folded = {
          type: foldedType,
          text: source.text,
        };
        const alreadyFolded = target.conditions?.some(condition => condition.text === folded.text) ?? false;
        if (!alreadyFolded) {
          byId.set(target.id, { ...target, conditions: [...(target.conditions ?? []), folded] });
        }
        break;
      }
      case 'refines':
      case 'contrasts':
        break; // recorded only
    }
  }

  return { units: [...byId.values()], recordedRelations, diagnostics };
}
