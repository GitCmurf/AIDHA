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
  /** Failed units / total units; consumer acceptance thresholds are separate policy. */
  readonly failureRatio: number;
}

const MIN_QUOTE_WORDS = 5;
const MIN_UNIQUE_QUOTE_TOKENS = 4;
const MAX_QUOTE_EXCERPT_RATIO = 0.5;

const normalizeQuoteText = (value: string): string => {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Approximate overlap must never stand in for a literal quotation. */
export const isLiteralQuote = (quote: string, text: string): boolean => {
  return verifyQuote(quote, text) !== 'failed' && normalizeQuoteText(text).includes(normalizeQuoteText(quote));
};

const tokensOf = (value: string): string[] => {
  return normalizeQuoteText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
};

/** A substring inside "ineffective" or "+15" is not the claimed word or number. */
const containsWholeSpan = (excerpt: string, quote: string): boolean => {
  if (!quote) return false;
  const attached = /[\p{L}\p{N}\p{M}_+\-−.,]/u;
  const word = /[\p{L}\p{N}\p{M}]/u;
  const quotePoints = Array.from(quote);
  const first = quotePoints[0]!;
  const last = quotePoints.at(-1)!;
  const numericStart = /^[+\-−]?[.,]?\p{N}/u.test(quote);
  const numericPunctuationEnd = /\p{N}[.,]$/u.test(quote);
  let start = excerpt.indexOf(quote);
  while (start !== -1) {
    const before = Array.from(excerpt.slice(0, start)).at(-1) ?? '';
    const after = Array.from(excerpt.slice(start + quote.length))[0] ?? '';
    const truncatedNumber = /\p{N}/u.test(last) && /^[.,]\p{N}/u.test(excerpt.slice(start + quote.length));
    if (!((word.test(first) || numericStart) && attached.test(before)) &&
        !((word.test(last) || numericPunctuationEnd) && /[\p{L}\p{N}\p{M}_]/u.test(after)) && !truncatedNumber) return true;
    start = excerpt.indexOf(quote, start + 1);
  }
  return false;
};

export const verifyQuote = (quote: string, excerptText: string): QuoteVerificationStatus => {
  const quoteTokens = tokensOf(quote);
  if (quoteTokens.length < MIN_QUOTE_WORDS) return 'failed';
  const uniqueQuoteTokens = new Set(quoteTokens);
  if (uniqueQuoteTokens.size < MIN_UNIQUE_QUOTE_TOKENS) return 'failed';
  const excerptTokens = tokensOf(excerptText);
  if (excerptTokens.length === 0) return 'failed';
  if (quoteTokens.length > excerptTokens.length * MAX_QUOTE_EXCERPT_RATIO) return 'failed';

  if (containsWholeSpan(excerptText, quote)) return 'exact';

  const normalizedQuote = normalizeQuoteText(quote);
  const normalizedExcerpt = normalizeQuoteText(excerptText);
  if (containsWholeSpan(normalizedExcerpt, normalizedQuote)) return 'normalized';

  // Token overlap cannot verify a quotation: dropping "not" can reverse its meaning.
  // Keep the legacy fuzzy status readable, but never award it to new evidence.
  return 'failed';
};

/** Eligibility only: acceptance must still use verifyQuote on replacement evidence. */
export const isOverlongLiteralQuote = (quote: string, excerptText: string): boolean => {
  const tokens = tokensOf(quote);
  return tokens.length >= MIN_QUOTE_WORDS && new Set(tokens).size >= MIN_UNIQUE_QUOTE_TOKENS &&
    tokens.length > tokensOf(excerptText).length * MAX_QUOTE_EXCERPT_RATIO &&
    containsWholeSpan(excerptText, quote);
};

export const verifyDistillationEvidence = (units: readonly KnowledgeUnit[], excerptTextById: ReadonlyMap<string, string>): EvidenceVerificationResult => {
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
    // A valid reference must not launder a fabricated reference on the same claim.
    if (evidence.length === 0 || evidence.some(ref => ref.quoteVerification === 'failed')) failedUnitIds.push(unit.id);
    verified.push({ ...unit, evidence });
  }

  return {
    units: verified,
    failedUnitIds,
    weakQuoteCount,
    failureRatio: units.length === 0 ? 0 : failedUnitIds.length / units.length,
  };
};
