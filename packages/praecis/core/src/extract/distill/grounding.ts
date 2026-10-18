// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { z } from 'zod';
import { capErrors, extractJsonObject } from './json.js';
import type { VerifiedUnit } from './quote-verification.js';
import { KnowledgeUnitSchema, UnitAttributionSchema, UnitConditionSchema, UNIT_IMPORTANCES, UNIT_STANCES } from './schema.js';

export const GROUNDING_VERDICTS = ['grounded', 'rewrite', 'ungrounded'] as const;

const GroundingVerdictSchema = z.object({
  unitId: z.string().min(1),
  verdict: z.enum(GROUNDING_VERDICTS),
  text: z.string().min(20).optional(),
  rationale: z.string().min(1).nullable().optional(),
  conditions: z.array(UnitConditionSchema).optional(),
  attribution: UnitAttributionSchema.nullable().optional(),
  stance: z.enum(UNIT_STANCES).optional(),
  importance: z.enum(UNIT_IMPORTANCES).optional(),
});

const GroundingResponseSchema = z.object({ verdicts: z.array(z.unknown()) });

export type GroundingVerdict = z.infer<typeof GroundingVerdictSchema>;

export type ParseVerdictsResult =
  | { readonly ok: true; readonly value: readonly GroundingVerdict[]; readonly errors: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface RejectedUnit {
  readonly unit: VerifiedUnit;
  readonly reason: 'ungrounded' | 'failed_quote_verification';
}

export interface GroundingApplication {
  readonly kept: readonly VerifiedUnit[];
  readonly rejected: readonly RejectedUnit[];
  readonly diagnostics: readonly string[];
}

export const parseGroundingVerdicts = (raw: string): ParseVerdictsResult => {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, errors: ['Grounding response contains no JSON object.'] };
  try {
    const parsed = GroundingResponseSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return { ok: false, errors: capErrors(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)) };
    }
    const value: GroundingVerdict[] = [];
    const errors: string[] = [];
    for (const [index, entry] of parsed.data.verdicts.entries()) {
      const verdict = GroundingVerdictSchema.safeParse(entry);
      if (verdict.success) value.push(verdict.data);
      else errors.push(...verdict.error.issues.map(issue => `verdicts.${index}.${issue.path.join('.')}: ${issue.message}`));
    }
    return { ok: true, value, errors: capErrors(errors) };
  } catch (error) {
    return { ok: false, errors: [`Grounding response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
};

/** Missing verdicts retain untrusted drafts; semantic review is advisory. */
export const applyGroundingVerdicts = (units: readonly VerifiedUnit[], verdicts: readonly GroundingVerdict[]): GroundingApplication => {
  const unitIds = new Set(units.map(unit => unit.id));
  const verdictByUnitId = new Map<string, GroundingVerdict>();
  const diagnostics: string[] = [];
  for (const verdict of verdicts) {
    if (!unitIds.has(verdict.unitId)) {
      diagnostics.push(`${verdict.unitId}: unknown unit, verdict ignored.`);
      continue;
    }
    if (verdictByUnitId.has(verdict.unitId)) {
      diagnostics.push(`Duplicate grounding verdict for unit ${verdict.unitId} ignored.`);
      continue;
    }
    verdictByUnitId.set(verdict.unitId, verdict);
  }

  const kept: VerifiedUnit[] = [];
  const rejected: RejectedUnit[] = [];
  for (const unit of units) {
    const verdict = verdictByUnitId.get(unit.id);
    if (!verdict) {
      diagnostics.push(`Unit ${unit.id} received no grounding verdict; kept (quote verification already passed).`);
      kept.push(unit);
      continue;
    }
    if (verdict.verdict === 'ungrounded') {
      rejected.push({ unit, reason: 'ungrounded' });
      continue;
    }
    if (verdict.verdict !== 'rewrite') {
      kept.push(unit);
      continue;
    }
    if (verdict.text === undefined && verdict.rationale === undefined && verdict.conditions === undefined &&
        verdict.attribution === undefined && verdict.stance === undefined && verdict.importance === undefined) {
      diagnostics.push(`Rewrite verdict for unit ${unit.id} carried no text, rationale or metadata correction; original untrusted draft retained.`);
      kept.push(unit);
      continue;
    }

    const revised: VerifiedUnit = {
      ...unit,
      text: verdict.text ?? unit.text,
      ...(verdict.conditions !== undefined ? { conditions: verdict.conditions } : {}),
      ...(verdict.stance !== undefined ? { stance: verdict.stance } : {}),
      ...(verdict.importance !== undefined ? { importance: verdict.importance } : {}),
    };
    if (verdict.rationale === null) delete revised.rationale;
    else if (verdict.rationale !== undefined) revised.rationale = verdict.rationale;
    if (verdict.attribution === null) delete revised.attribution;
    else if (verdict.attribution !== undefined) revised.attribution = verdict.attribution;
    const validated = KnowledgeUnitSchema.safeParse(revised);
    if (!validated.success) {
      diagnostics.push(`Invalid grounding rewrite for unit ${unit.id}; rejected: ${validated.error.issues.map(issue => issue.message).join('; ')}`);
      rejected.push({ unit, reason: 'ungrounded' });
    } else {
      // Host schema transformations still apply, but the judge cannot change evidence.
      kept.push({ ...validated.data, evidence: unit.evidence });
    }
  }
  return { kept, rejected, diagnostics };
};
