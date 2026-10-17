// SPDX-License-Identifier: Apache-2.0
import type { SegmentRepairRecord } from '../../interfaces/index.js';
import type { LlmCompletionResult } from '../llm-client.js';
import { applyGroundingVerdicts, parseGroundingVerdicts, type RejectedUnit } from './grounding.js';
import type { VerifiedUnit } from './quote-verification.js';

export interface GroundingAdmissionInput {
  readonly originalUnits: readonly VerifiedUnit[];
  readonly failedUnitIds: ReadonlySet<string>;
  readonly replacements: ReadonlyMap<string, VerifiedUnit>;
  readonly kept: readonly VerifiedUnit[];
  readonly rejected: readonly RejectedUnit[];
  readonly segmentRepairs: readonly SegmentRepairRecord[];
  readonly grounding: LlmCompletionResult | undefined;
  readonly threshold: number;
}

export interface GroundingAdmissionResult {
  readonly kept: readonly VerifiedUnit[];
  readonly rejected: readonly RejectedUnit[];
  readonly segmentRepairs: readonly SegmentRepairRecord[];
  readonly affirmativeGroundingIds: ReadonlySet<string>;
  readonly diagnostics: readonly string[];
  readonly closeReason?: string;
}

/** A failed run cannot leave a provisional or grounded repair marked as admitted. */
export const rejectSegmentRepairs = (records: readonly SegmentRepairRecord[]): SegmentRepairRecord[] =>
  records.map(record => ({ ...record, status: 'rejected' }));

/** Byte-stable supplement to the ordinary grounding request for segmented units. */
export const buildSegmentedGroundingReview = (records: readonly SegmentRepairRecord[]): string => records.length ? [
  'For SEGMENTED_EVIDENCE, judge whether ALL listed exact segments together support the WHOLE unchanged unit, including conditions, quantities, attribution and uncertainty. Source context cannot substitute for missing support in these segments. Return ungrounded if material support is absent; a rewrite cannot admit a segmented unit.',
  'SEGMENTED_EVIDENCE:', JSON.stringify(records.map(record => ({ unitId: record.unitId,
    evidence: record.finalEvidence }))),
].join('\n') : '';

/** Pure grounding and admission transition; transport and token accounting stay with the miner. */
export function finalizeGroundingAdmission(input: GroundingAdmissionInput): GroundingAdmissionResult {
  let kept = [...input.kept];
  let rejected = [...input.rejected];
  const diagnostics: string[] = [];
  const affirmativeGroundingIds = new Set<string>();
  if (input.grounding) {
    if (!input.grounding.ok) {
      diagnostics.push(`Grounding transport failure (advisory); retaining untrusted drafts: ${input.grounding.error.message}`);
    } else {
      const verdicts = parseGroundingVerdicts(input.grounding.value);
      if (!verdicts.ok) {
        diagnostics.push(`Grounding parse failure (advisory); retaining untrusted drafts: ${verdicts.errors.join('; ')}`);
      } else {
        diagnostics.push(...verdicts.errors);
        const applied = applyGroundingVerdicts(kept, verdicts.value);
        kept = [...applied.kept];
        rejected.push(...applied.rejected);
        diagnostics.push(...applied.diagnostics);
        const counts = new Map<string, number>();
        for (const verdict of verdicts.value) counts.set(verdict.unitId, (counts.get(verdict.unitId) ?? 0) + 1);
        const keptIds = new Set(kept.map(unit => unit.id));
        for (const verdict of verdicts.value) {
          if ((!input.replacements.has(verdict.unitId) || verdicts.errors.length === 0) &&
              verdict.verdict === 'grounded' && counts.get(verdict.unitId) === 1 && keptIds.has(verdict.unitId)) {
            affirmativeGroundingIds.add(verdict.unitId);
          }
        }
      }
    }
  }

  let segmentRepairs = [...input.segmentRepairs];
  let closeReason: string | undefined;
  if (input.replacements.size) {
    segmentRepairs = segmentRepairs.map(record => ({ ...record,
      status: affirmativeGroundingIds.has(record.unitId) ? 'grounded' as const : 'rejected' as const }));
    const originalsById = new Map(input.originalUnits.map(unit => [unit.id, unit]));
    for (const id of input.replacements.keys()) {
      if (affirmativeGroundingIds.has(id)) continue;
      kept = kept.filter(unit => unit.id !== id);
      rejected = rejected.filter(item => item.unit.id !== id);
      const original = originalsById.get(id);
      if (!original) throw new Error(`Segmented-evidence unit ${id} has no original candidate`);
      rejected.push({ unit: original, reason: 'failed_quote_verification' });
      diagnostics.push(`Segmented evidence for unit ${id} rejected without one explicit grounded verdict.`);
    }
    const finalFailedQuoteCount = input.failedUnitIds.size + [...input.replacements.keys()]
      .filter(id => !affirmativeGroundingIds.has(id)).length;
    if (input.originalUnits.length && finalFailedQuoteCount / input.originalUnits.length > input.threshold) {
      closeReason = 'Quote verification failure ratio exceeds the configured threshold after segmentation review';
    }
  }
  return { kept, rejected, segmentRepairs, affirmativeGroundingIds, diagnostics,
    ...(closeReason ? { closeReason } : {}) };
}
