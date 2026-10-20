// SPDX-License-Identifier: Apache-2.0
import { isOverlongLiteralQuote, verifyQuote, type VerifiedEvidence, type VerifiedUnit } from './quote-verification.js';
import type { SegmentRepairRecord } from '../../interfaces/index.js';

export const SEGMENTED_EVIDENCE_VERSION = 'complete-segmented-evidence-v1';
const MAX_SEGMENTS_PER_REFERENCE = 4;
const MAX_REPAIRED_UNITS = 8;
const MAX_FAILED_REFERENCES_PER_UNIT = 4;
const MAX_FAILED_REFERENCES_PER_SOURCE = 8;
const MAX_TOTAL_SEGMENTS = 32;
const MAX_QUOTE_CHARS = 4096;
const MAX_EXCERPT_CHARS = 16000;
const MAX_VERIFICATION_ATTEMPTS = 128;

/** Split only at existing whitespace; every emitted piece remains a source-exact span. */
export function segmentOverlongQuote(quote: string, excerpt: string): readonly string[] | null {
  if (quote.length > MAX_QUOTE_CHARS || excerpt.length > MAX_EXCERPT_CHARS ||
      !isOverlongLiteralQuote(quote, excerpt)) return null;
  const sentenceEnds = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(quote)]
    .map(sentence => sentence.index + sentence.segment.length);
  const whitespaceEnds = [...quote.matchAll(/\s+/gu)].map(match => match.index + match[0].length)
    .filter(end => end > 0 && end < quote.length);
  const available = new Set(whitespaceEnds);
  const sentenceBoundaries = new Set(sentenceEnds.filter(end => available.has(end)));
  let attempts = 0;
  const valid = (part: string): boolean => {
    if (++attempts > MAX_VERIFICATION_ATTEMPTS) return false;
    return verifyQuote(part, excerpt) === 'exact';
  };
  const partition = (start: number, used: number): string[] | null => {
    const remaining = quote.slice(start).trim();
    if (valid(remaining)) return [remaining];
    if (used >= MAX_SEGMENTS_PER_REFERENCE - 1 || attempts >= MAX_VERIFICATION_ATTEMPTS) return null;
    // Try a small set of existing sentence cuts first, then balanced word cuts.
    // A reverse scan would exhaust the budget on long single-sentence quotations.
    const midpoint = start + (quote.length - start) / 2;
    const byBalance = (a: number, b: number) => Math.abs(a - midpoint) - Math.abs(b - midpoint);
    const preferred = whitespaceEnds.filter(end => end > start && sentenceBoundaries.has(end))
      .sort(byBalance).slice(0, 16);
    const selected = new Set(preferred);
    const boundaries = [...preferred, ...whitespaceEnds.filter(end => end > start && !selected.has(end)).sort(byBalance)];
    for (const end of boundaries) {
      const first = quote.slice(start, end).trim();
      if (!valid(first)) continue;
      const rest = partition(end, used + 1);
      if (rest) return [first, ...rest];
      if (attempts >= MAX_VERIFICATION_ATTEMPTS) return null;
    }
    return null;
  };
  const pieces = partition(0, 0);
  if (!pieces || pieces.length < 2 || pieces.length > MAX_SEGMENTS_PER_REFERENCE) return null;
  // This is a host invariant, independent of semantic grounding: no original words or punctuation vanish.
  const normalizeBoundaryWhitespace = (value: string) => value.trim().replace(/\s+/gu, ' ');
  if (normalizeBoundaryWhitespace(pieces.join(' ')) !== normalizeBoundaryWhitespace(quote)) return null;
  return pieces;
}

/** All-or-nothing per unit: an invented or unsplittable failed reference remains rejected. */
export function prepareSegmentedEvidence(units: readonly VerifiedUnit[], excerpts: ReadonlyMap<string, string>) {
  const repaired: VerifiedUnit[] = [];
  const records: SegmentRepairRecord[] = [];
  let attemptedReferences = 0;
  let totalSegments = 0;
  for (const unit of units) {
    if (records.length >= MAX_REPAIRED_UNITS) break;
    const failed = unit.evidence.filter(reference => reference.quoteVerification === 'failed');
    if (!failed.length) continue;
    if (failed.length > MAX_FAILED_REFERENCES_PER_UNIT) continue;
    if (attemptedReferences + failed.length > MAX_FAILED_REFERENCES_PER_SOURCE) break;
    attemptedReferences += failed.length;
    const finalEvidence: VerifiedEvidence[] = [];
    const replacementEvidence: VerifiedEvidence[] = [];
    let eligible = true;
    for (const reference of unit.evidence) {
      if (reference.quoteVerification !== 'failed') {
        finalEvidence.push(reference);
        continue;
      }
      const excerpt = excerpts.get(reference.excerptId);
      const pieces = excerpt === undefined ? null : segmentOverlongQuote(reference.quote, excerpt);
      if (!pieces) { eligible = false; break; }
      for (const piece of pieces) {
        const replacement = { excerptId: reference.excerptId, quote: piece, quoteVerification: 'exact' as const };
        replacementEvidence.push(replacement);
        finalEvidence.push(replacement);
      }
    }
    if (!eligible || totalSegments + replacementEvidence.length > MAX_TOTAL_SEGMENTS) continue;
    totalSegments += replacementEvidence.length;
    repaired.push({ ...unit, evidence: finalEvidence });
    records.push({ unitId: unit.id, originalUnit: unit, replacementEvidence, finalEvidence,
      status: 'awaiting_grounding' });
  }
  return { repaired, records };
}
