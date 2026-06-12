// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { KnowledgeUnit } from './schema.js';

export const QUOTE_VERIFICATION_STATUSES = ['exact', 'normalized', 'fuzzy', 'failed'] as const;
export type QuoteVerificationStatus = typeof QUOTE_VERIFICATION_STATUSES[number];

export interface VerifiedEvidence {
  readonly excerptId: string;
  readonly quote: string;
  readonly quoteVerification: QuoteVerificationStatus;
}

export type VerifiedUnit = Omit<KnowledgeUnit, 'evidence'> & { readonly evidence: readonly VerifiedEvidence[] };

export interface EvidenceVerificationResult {
  readonly units: readonly VerifiedUnit[];
  readonly failedUnitIds: readonly string[];
  readonly weakQuoteCount: number;
  /** failed units / total units; the miner fails closed above a threshold. */
  readonly failureRatio: number;
}

const MIN_QUOTE_WORDS = 5;
const MIN_UNIQUE_QUOTE_TOKENS = 4;
const MAX_QUOTE_EXCERPT_RATIO = 0.5;
// A quote token window must cover at least this fraction of quote tokens to count as fuzzy.
const FUZZY_MIN_TOKEN_COVERAGE = 0.8;

function normalizeQuoteText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ') // timecode artifacts like [12:34]
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(value: string): string[] {
  return normalizeQuoteText(value).split(' ').filter(Boolean);
}

export function verifyQuote(quote: string, excerptText: string): QuoteVerificationStatus {
  const quoteTokens = tokensOf(quote);
  if (quoteTokens.length < MIN_QUOTE_WORDS) return 'failed';
  const uniqueQuoteTokens = new Set(quoteTokens);
  if (uniqueQuoteTokens.size < MIN_UNIQUE_QUOTE_TOKENS) return 'failed';
  const excerptTokens = tokensOf(excerptText);
  if (excerptTokens.length === 0) return 'failed';
  if (quoteTokens.length > excerptTokens.length * MAX_QUOTE_EXCERPT_RATIO) return 'failed';

  if (excerptText.includes(quote)) return 'exact';

  const normalizedQuote = quoteTokens.join(' ');
  const normalizedExcerpt = excerptTokens.join(' ');
  if (normalizedExcerpt.includes(normalizedQuote)) return 'normalized';

  // Fuzzy: slide a window of quote-token length across the excerpt and
  // measure unordered token coverage within the best window.
  const windowSize = quoteTokens.length;
  let best = 0;
  for (let start = 0; start + windowSize <= excerptTokens.length; start++) {
    const window = excerptTokens.slice(start, start + windowSize);
    const windowSet = new Set(window);
    let covered = 0;
    for (const token of uniqueQuoteTokens) {
      if (windowSet.has(token)) covered += 1;
    }
    best = Math.max(best, covered / uniqueQuoteTokens.size);
  }
  return best >= FUZZY_MIN_TOKEN_COVERAGE ? 'fuzzy' : 'failed';
}

export function verifyDistillationEvidence(
  units: readonly KnowledgeUnit[],
  excerptTextById: ReadonlyMap<string, string>
): EvidenceVerificationResult {
  const verified: VerifiedUnit[] = [];
  const failedUnitIds: string[] = [];
  let weakQuoteCount = 0;

  for (const unit of units) {
    const evidence: VerifiedEvidence[] = unit.evidence.map(ref => {
      const excerptText = excerptTextById.get(ref.excerptId) ?? '';
      const quoteVerification = verifyQuote(ref.quote, excerptText);
      if (quoteVerification === 'failed') weakQuoteCount += 1;
      return { excerptId: ref.excerptId, quote: ref.quote, quoteVerification };
    });
    const anyVerified = evidence.some(ref => ref.quoteVerification !== 'failed');
    if (!anyVerified) failedUnitIds.push(unit.id);
    verified.push({ ...unit, evidence });
  }

  return {
    units: verified,
    failedUnitIds,
    weakQuoteCount,
    failureRatio: units.length === 0 ? 0 : failedUnitIds.length / units.length,
  };
}
