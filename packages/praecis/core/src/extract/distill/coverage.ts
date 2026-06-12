// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { VerifiedUnit } from './quote-verification.js';

export interface CoverageExcerpt {
  readonly id: string;
  readonly text: string;
  readonly startSec?: number;
  readonly endSec?: number;
}

export interface CoverageDiagnostics {
  readonly citedExcerptCount: number;
  readonly excerptsCitedPercent: number;
  readonly citedTextPercent: number;
  readonly largestUncitedGapSeconds: number;
  readonly coreUnitsWithoutVerifiedEvidence: number;
  readonly weakQuoteCount: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeCoverage(
  units: readonly VerifiedUnit[],
  excerpts: readonly CoverageExcerpt[]
): CoverageDiagnostics {
  const citedIds = new Set<string>();
  let weakQuoteCount = 0;
  let coreUnitsWithoutVerifiedEvidence = 0;

  for (const unit of units) {
    let anyVerified = false;
    for (const ref of unit.evidence) {
      if (ref.quoteVerification === 'failed') {
        weakQuoteCount += 1;
      } else {
        citedIds.add(ref.excerptId);
        anyVerified = true;
      }
    }
    if (unit.importance === 'core' && !anyVerified) coreUnitsWithoutVerifiedEvidence += 1;
  }

  const totalText = excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0);
  const citedText = excerpts
    .filter(excerpt => citedIds.has(excerpt.id))
    .reduce((sum, excerpt) => sum + excerpt.text.length, 0);

  // Largest contiguous run of uncited timecoded excerpts.
  let largestGap = 0;
  let runStart: number | undefined;
  let runEnd: number | undefined;
  const flush = (): void => {
    if (runStart !== undefined && runEnd !== undefined) {
      largestGap = Math.max(largestGap, runEnd - runStart);
    }
    runStart = undefined;
    runEnd = undefined;
  };
  for (const excerpt of excerpts) {
    if (excerpt.startSec === undefined || excerpt.endSec === undefined) continue;
    if (citedIds.has(excerpt.id)) {
      flush();
      continue;
    }
    if (runStart === undefined) runStart = excerpt.startSec;
    runEnd = excerpt.endSec;
  }
  flush();

  return {
    citedExcerptCount: citedIds.size,
    excerptsCitedPercent: excerpts.length === 0 ? 0 : round1((citedIds.size / excerpts.length) * 100),
    citedTextPercent: totalText === 0 ? 0 : round1((citedText / totalText) * 100),
    largestUncitedGapSeconds: largestGap,
    coreUnitsWithoutVerifiedEvidence,
    weakQuoteCount,
  };
}
