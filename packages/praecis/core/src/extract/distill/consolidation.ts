// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { z } from 'zod';
import { capErrors, extractJsonObject } from './json.js';
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
      return { ok: false, errors: capErrors(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)) };
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
  units: readonly ConsolidatedUnit[],
  relations: readonly UnitRelation[]
): ConsolidationResult {
  const diagnostics: string[] = [];
  const inputIds = new Set(units.map(unit => unit.id));

  // ── Phase 1: union-find over merged_duplicate relations ──────────────────

  const parent = new Map<string, string>(units.map(unit => [unit.id, unit.id]));

  function find(id: string): string {
    const visited = new Set<string>();
    let current = id;
    while (true) {
      if (visited.has(current)) {
        // Cycle detected in parent chain — return current as best-effort root
        return current;
      }
      visited.add(current);
      const p = parent.get(current);
      if (p === undefined || p === current) return current;
      current = p;
    }
  }

  function union(sourceId: string, targetId: string): void {
    // target is the canonical root preference
    const rootTarget = find(targetId);
    const rootSource = find(sourceId);
    if (rootSource !== rootTarget) {
      parent.set(rootSource, rootTarget);
    }
  }

  for (const relation of relations) {
    if (relation.type !== 'merged_duplicate') continue;
    const { sourceUnitId, targetUnitId } = relation;

    // Validate: both ids must exist among input units
    if (!inputIds.has(sourceUnitId) || !inputIds.has(targetUnitId)) {
      diagnostics.push(`Relation merged_duplicate ${sourceUnitId}->${targetUnitId} references unknown or identical units; ignored.`);
      continue;
    }
    // Self-referential
    if (sourceUnitId === targetUnitId) {
      diagnostics.push(`Relation merged_duplicate ${sourceUnitId}->${targetUnitId} references unknown or identical units; ignored.`);
      continue;
    }
    // Already in same component — cyclic/redundant merge instruction
    if (find(sourceUnitId) === find(targetUnitId)) {
      diagnostics.push(`Relation merged_duplicate ${sourceUnitId}->${targetUnitId} is redundant or cyclic; ignored.`);
      continue;
    }
    union(sourceUnitId, targetUnitId);
  }

  // ── Phase 2: build merged units grouped by canonical id ──────────────────

  // Group input units by canonical id (input order preserved)
  const groups = new Map<string, ConsolidatedUnit[]>();
  for (const unit of units) {
    const canonical = find(unit.id);
    const group = groups.get(canonical);
    if (group) {
      group.push(unit);
    } else {
      groups.set(canonical, [unit]);
    }
  }

  // Build output units: one per canonical group
  const outputById = new Map<string, ConsolidatedUnit>();
  for (const [canonicalId, group] of groups) {
    // The canonical unit is the one whose id IS the canonical id
    const base = group.find(unit => unit.id === canonicalId);
    if (!base) {
      diagnostics.push(`Canonical unit ${canonicalId} not found in group; this is a bug.`);
      continue;
    }
    const nonCanonicalMembers = group.filter(unit => unit.id !== canonicalId);

    if (nonCanonicalMembers.length === 0) {
      // Singleton group — no merge needed; preserve input object as-is
      outputById.set(canonicalId, base);
    } else {
      // Merge all non-canonical members into base
      const seenEvidence = new Set(base.evidence.map(ref => `${ref.excerptId}::${ref.quote}`));
      const mergedEvidence = [...base.evidence];
      for (const member of nonCanonicalMembers) {
        for (const ref of member.evidence) {
          const key = `${ref.excerptId}::${ref.quote}`;
          if (!seenEvidence.has(key)) {
            seenEvidence.add(key);
            mergedEvidence.push(ref);
          }
        }
      }

      // Collect mergedFromUnitIds: pre-existing on base + all non-canonical member ids + their pre-existing mergedFromUnitIds
      const mergedFromSet = new Set<string>(base.mergedFromUnitIds ?? []);
      for (const member of nonCanonicalMembers) {
        mergedFromSet.add(member.id);
        for (const id of member.mergedFromUnitIds ?? []) {
          mergedFromSet.add(id);
        }
      }
      // Preserve input order: iterate all input units, keeping those in mergedFromSet
      const mergedFromUnitIds = units.map(unit => unit.id).filter(id => mergedFromSet.has(id));

      outputById.set(canonicalId, {
        ...base,
        evidence: mergedEvidence,
        mergedFromUnitIds,
      });
    }
  }

  // ── Apply non-merge relations (with endpoint remapping) ─────────────────

  const recordedRelations: UnitRelation[] = [];

  for (const relation of relations) {
    if (relation.type === 'merged_duplicate') continue;

    const { sourceUnitId, targetUnitId } = relation;
    // Remap endpoints through find
    const remappedSource = find(sourceUnitId);
    const remappedTarget = find(targetUnitId);

    // Validate remapped endpoints exist and are not identical
    if (!outputById.has(remappedSource) || !outputById.has(remappedTarget)) {
      diagnostics.push(`Relation ${relation.type} ${sourceUnitId}->${targetUnitId} references unknown units after remapping; ignored.`);
      continue;
    }
    if (remappedSource === remappedTarget) {
      diagnostics.push(`Relation ${relation.type} ${sourceUnitId}->${targetUnitId} maps to self after remapping; ignored.`);
      continue;
    }

    const remappedRelation: UnitRelation = { type: relation.type, sourceUnitId: remappedSource, targetUnitId: remappedTarget };
    recordedRelations.push(remappedRelation);

    const source = outputById.get(remappedSource)!;
    const target = outputById.get(remappedTarget)!;

    switch (relation.type) {
      case 'supports':
      case 'example_of': {
        const existing = new Set(source.supportsUnitIds ?? []);
        existing.add(remappedTarget);
        outputById.set(remappedSource, { ...source, supportsUnitIds: [...existing] });
        break;
      }
      case 'limits': {
        const foldedType: ConditionType = source.conditions?.[0]?.type ?? 'assumption';
        const folded = { type: foldedType, text: source.text };
        const alreadyFolded = target.conditions?.some(condition => condition.text === folded.text) ?? false;
        if (!alreadyFolded) {
          outputById.set(remappedTarget, { ...target, conditions: [...(target.conditions ?? []), folded] });
        }
        break;
      }
      case 'refines':
      case 'contrasts':
        break; // recorded only
    }
  }

  // ── Global supportsUnitIds remap ─────────────────────────────────────────

  for (const [id, unit] of outputById) {
    if (!unit.supportsUnitIds) continue;
    const remapped = [...new Set(
      unit.supportsUnitIds
        .map(ref => find(ref))
        .filter(ref => ref !== id && outputById.has(ref))
    )];
    if (remapped.length === 0) {
      // Omit supportsUnitIds entirely if empty after filtering
      const { supportsUnitIds: _omit, ...rest } = unit;
      outputById.set(id, rest as ConsolidatedUnit);
    } else {
      outputById.set(id, { ...unit, supportsUnitIds: remapped });
    }
  }

  // Output in input order (canonical units appear in position of their original unit)
  const outputUnits: ConsolidatedUnit[] = [];
  const emitted = new Set<string>();
  for (const unit of units) {
    const canonical = find(unit.id);
    if (!emitted.has(canonical) && outputById.has(canonical)) {
      outputUnits.push(outputById.get(canonical)!);
      emitted.add(canonical);
    }
  }

  return { units: outputUnits, recordedRelations, diagnostics };
}
