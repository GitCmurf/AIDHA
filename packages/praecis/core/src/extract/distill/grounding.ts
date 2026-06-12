// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { z } from 'zod';
import { extractJsonObject } from './json.js';
import type { VerifiedUnit } from './quote-verification.js';

export const GROUNDING_VERDICTS = ['grounded', 'rewrite', 'ungrounded'] as const;

const GroundingVerdictSchema = z.object({
  unitId: z.string().min(1),
  verdict: z.enum(GROUNDING_VERDICTS),
  text: z.string().min(20).optional(),
  rationale: z.string().min(1).optional(),
});

const GroundingResponseSchema = z.object({
  verdicts: z.array(GroundingVerdictSchema),
});

export type GroundingVerdict = z.infer<typeof GroundingVerdictSchema>;

export type ParseVerdictsResult =
  | { readonly ok: true; readonly value: readonly GroundingVerdict[] }
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

export function parseGroundingVerdicts(raw: string): ParseVerdictsResult {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, errors: ['Grounding response contains no JSON object.'] };
  try {
    const parsed = GroundingResponseSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
    }
    return { ok: true, value: parsed.data.verdicts };
  } catch (error) {
    return { ok: false, errors: [`Grounding response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/**
 * Applies judge verdicts. Quote verification is the hard gate upstream;
 * the judge is advisory repair/reject, so a missing verdict keeps the unit
 * (with a diagnostic) rather than dropping it.
 */
export function applyGroundingVerdicts(
  units: readonly VerifiedUnit[],
  verdicts: readonly GroundingVerdict[]
): GroundingApplication {
  const unitIds = new Set(units.map(unit => unit.id));
  const verdictByUnitId = new Map<string, GroundingVerdict>();
  const diagnostics: string[] = [];

  for (const verdict of verdicts) {
    if (!unitIds.has(verdict.unitId)) {
      diagnostics.push(`${verdict.unitId}: unknown unit, verdict ignored.`);
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
    if (verdict.verdict === 'rewrite') {
      kept.push({
        ...unit,
        text: verdict.text ?? unit.text,
        ...(verdict.rationale ? { rationale: verdict.rationale } : unit.rationale ? { rationale: unit.rationale } : {}),
      });
      continue;
    }
    kept.push(unit);
  }

  return { kept, rejected, diagnostics };
}
