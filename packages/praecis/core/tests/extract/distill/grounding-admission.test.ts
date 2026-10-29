import { expect, it } from 'vitest';
import { buildSegmentedGroundingReview, finalizeGroundingAdmission,
  rejectSegmentRepairs } from '../../../src/extract/distill/grounding-admission.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';
import type { SegmentRepairRecord } from '../../../src/interfaces/index.js';

const ordinary: VerifiedUnit = { id: 'u1', kind: 'fact',
  text: 'The trial measured forty extra alerts on five machines over two weeks.',
  stance: 'asserted', importance: 'core',
  evidence: [{ excerptId: 'alert-2', quote: 'The trial measured forty extra alerts on five machines.', quoteVerification: 'exact' }] };
const original: VerifiedUnit = { id: 'u4', kind: 'recommendation',
  text: 'Keep the current threshold outside the trial machines until the stated condition holds.',
  stance: 'recommended', importance: 'core',
  evidence: [{ excerptId: 'alert-3', quote: 'The operations lead recommended a wider trial only after four weeks below one in ten, while keeping the current threshold elsewhere.', quoteVerification: 'failed' }] };
const replacement: VerifiedUnit = { ...original, evidence: [
  { excerptId: 'alert-3', quote: 'The operations lead recommended a wider trial only after four weeks below one in ten.', quoteVerification: 'exact' },
  { excerptId: 'alert-3', quote: 'Keep the current threshold elsewhere during the trial.', quoteVerification: 'exact' },
] };
const repair: SegmentRepairRecord = { unitId: 'u4', originalUnit: original,
  replacementEvidence: replacement.evidence, finalEvidence: replacement.evidence,
  status: 'awaiting_grounding' };
const response = (verdicts: unknown[]) => ({ ok: true as const, value: JSON.stringify({ verdicts }) });
const finalize = (grounding: ReturnType<typeof response> | { ok: false; error: Error } | undefined,
  threshold = 0.5) => finalizeGroundingAdmission({ originalUnits: [ordinary, original],
  failedUnitIds: new Set<string>(), replacements: new Map([['u4', replacement]]),
  kept: [ordinary, replacement], rejected: [], segmentRepairs: [repair], grounding, threshold });

it('requires a valid, unique grounded verdict to admit the complete repaired unit', () => {
  const result = finalize(response([{ unitId: 'u1', verdict: 'grounded' },
    { unitId: 'u4', verdict: 'grounded' }]));
  expect(result.kept).toEqual([ordinary, replacement]);
  expect(result.rejected).toEqual([]);
  expect(result.affirmativeGroundingIds).toEqual(new Set(['u1', 'u4']));
  expect(result.segmentRepairs[0]?.status).toBe('grounded');
  expect(result.closeReason).toBeUndefined();
});

it.each([
  { label: 'missing', verdicts: [{ unitId: 'u1', verdict: 'grounded' }] },
  { label: 'duplicate', verdicts: [{ unitId: 'u4', verdict: 'grounded' }, { unitId: 'u4', verdict: 'grounded' }] },
  { label: 'rewrite', verdicts: [{ unitId: 'u4', verdict: 'rewrite', text: original.text }] },
  { label: 'ungrounded', verdicts: [{ unitId: 'u4', verdict: 'ungrounded' }] },
])('retains original failed evidence on $label review', ({ verdicts }) => {
  const result = finalize(response(verdicts));
  expect(result.kept.map(unit => unit.id)).not.toContain('u4');
  expect(result.rejected).toContainEqual({ unit: original, reason: 'failed_quote_verification' });
  expect(result.segmentRepairs[0]?.status).toBe('rejected');
  expect(result.affirmativeGroundingIds.has('u4')).toBe(false);
});

it('rejects a repaired unit when a batch mixes a valid verdict with a malformed entry', () => {
  const result = finalize(response([{ unitId: 'u1', verdict: 'grounded' },
    { unitId: 'u4', verdict: 'grounded' }, { unitId: 'u4', verdict: 'not-a-verdict' }]));
  expect(result.affirmativeGroundingIds).toEqual(new Set(['u1']));
  expect(result.kept).toEqual([ordinary]);
  expect(result.rejected).toEqual([{ unit: original, reason: 'failed_quote_verification' }]);
  expect(result.diagnostics.join(' ')).toMatch(/verdicts\.2|segmented evidence/iu);
});

it('keeps ordinary quote-valid units on advisory transport failure while rejecting the repair', () => {
  const result = finalize({ ok: false, error: new Error('temporary failure') });
  expect(result.kept).toEqual([ordinary]);
  expect(result.affirmativeGroundingIds.size).toBe(0);
  expect(result.diagnostics.join(' ')).toMatch(/Grounding transport failure.*temporary failure/iu);
  expect(result.segmentRepairs[0]?.status).toBe('rejected');
});

it('retains ordinary advisory behavior on a mixed valid and malformed batch without repairs', () => {
  const result = finalizeGroundingAdmission({ originalUnits: [ordinary], failedUnitIds: new Set(),
    replacements: new Map(), kept: [ordinary], rejected: [], segmentRepairs: [], threshold: 0.3,
    grounding: response([{ unitId: 'u1', verdict: 'grounded' }, { unitId: 'u1', verdict: 'invalid' }]) });
  expect(result.kept).toEqual([ordinary]);
  expect(result.affirmativeGroundingIds).toEqual(new Set(['u1']));
  expect(result.segmentRepairs).toEqual([]);
  expect(result.closeReason).toBeUndefined();
});

it('counts rejected repairs in the final failure ratio and marks the audit rejected', () => {
  const result = finalize(response([]), 0.3);
  expect(result.closeReason).toBe('Quote verification failure ratio exceeds the configured threshold after segmentation review');
  expect(result.segmentRepairs[0]?.status).toBe('rejected');
  expect(result.rejected).toEqual([{ unit: original, reason: 'failed_quote_verification' }]);
});

it('does not close when the one rejected repair is exactly at the allowed half-failure ratio', () => {
  const result = finalize(response([]), 0.5);
  expect(result.closeReason).toBeUndefined();
  expect(result.rejected).toEqual([{ unit: original, reason: 'failed_quote_verification' }]);
  expect(result.segmentRepairs[0]?.status).toBe('rejected');
});

it('counts a separate residual failed citation together with a rejected repair', () => {
  const residual: VerifiedUnit = { ...ordinary, id: 'u5',
    evidence: [{ excerptId: 'alert-2', quote: 'fabricated residual citation', quoteVerification: 'failed' }] };
  const input = { originalUnits: [ordinary, original, residual], failedUnitIds: new Set(['u5']),
    replacements: new Map([['u4', replacement]]), kept: [ordinary, replacement],
    rejected: [{ unit: residual, reason: 'failed_quote_verification' as const }],
    segmentRepairs: [repair], grounding: response([]), threshold: 0.5 };
  const result = finalizeGroundingAdmission(input);
  expect(result.closeReason).toBe('Quote verification failure ratio exceeds the configured threshold after segmentation review');
  expect(result.rejected).toEqual([
    { unit: residual, reason: 'failed_quote_verification' },
    { unit: original, reason: 'failed_quote_verification' },
  ]);
});

it('rejects provisional audit records on unrelated fail-closed paths', () => {
  expect(rejectSegmentRepairs([repair])).toEqual([{ ...repair, status: 'rejected' }]);
  expect(repair.status).toBe('awaiting_grounding');
});

it('builds the byte-stable supplemental grounding text from complete final evidence', () => {
  expect(buildSegmentedGroundingReview([])).toBe('');
  expect(buildSegmentedGroundingReview([repair])).toBe([
    'For SEGMENTED_EVIDENCE, judge whether ALL listed exact segments together support the WHOLE unchanged unit, including conditions, quantities, attribution and uncertainty. Source context cannot substitute for missing support in these segments. Return ungrounded if material support is absent; a rewrite cannot admit a segmented unit.',
    'SEGMENTED_EVIDENCE:', JSON.stringify([{ unitId: 'u4', evidence: replacement.evidence }]),
  ].join('\n'));
});
