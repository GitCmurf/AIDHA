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

const round1 = (value: number): number => {
  return Math.round(value * 10) / 10;
};

export const computeCoverage = (units: readonly VerifiedUnit[], excerpts: readonly CoverageExcerpt[]): CoverageDiagnostics => {
  const knownExcerptIds = new Set(excerpts.map(excerpt => excerpt.id));
  if (knownExcerptIds.size !== excerpts.length) {
    throw new RangeError('Duplicate excerpt IDs make citation diagnostics ambiguous.');
  }
  const citedIds = new Set<string>();
  let weakQuoteCount = 0;
  let coreUnitsWithoutVerifiedEvidence = 0;

  for (const unit of units) {
    let anyVerified = false;
    for (const ref of unit.evidence) {
      if ((ref.quoteVerification === 'exact' || ref.quoteVerification === 'normalized') &&
          knownExcerptIds.has(ref.excerptId)) {
        citedIds.add(ref.excerptId);
        anyVerified = true;
      } else {
        weakQuoteCount += 1;
      }
    }
    if (unit.importance === 'core' && !anyVerified) coreUnitsWithoutVerifiedEvidence += 1;
  }

  const totalText = excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0);
  const citedText = excerpts
    .filter(excerpt => citedIds.has(excerpt.id))
    .reduce((sum, excerpt) => sum + excerpt.text.length, 0);

  // Sweep interval boundaries: measure uncited time only where source excerpts
  // exist and no cited interval overlaps. Aggregate ties before the next segment.
  const events = new Map<number, { cited: number; uncited: number }>();
  for (const excerpt of excerpts) {
    const { startSec, endSec } = excerpt;
    if (startSec === undefined || endSec === undefined ||
        !Number.isFinite(startSec) || !Number.isFinite(endSec) ||
        startSec < 0 || endSec <= startSec) continue;
    const key = citedIds.has(excerpt.id) ? 'cited' : 'uncited';
    for (const [time, delta] of [[startSec, 1], [endSec, -1]] as const) {
      const event = events.get(time) ?? { cited: 0, uncited: 0 };
      event[key] += delta;
      events.set(time, event);
    }
  }
  let largestGap = 0;
  let runLength = 0;
  let previous = 0;
  let cited = 0;
  let uncited = 0;
  for (const [time, event] of [...events].sort(([a], [b]) => a - b)) {
    runLength = uncited > 0 && cited === 0 ? runLength + time - previous : 0;
    largestGap = Math.max(largestGap, runLength);
    cited += event.cited;
    uncited += event.uncited;
    previous = time;
  }

  return {
    citedExcerptCount: citedIds.size,
    excerptsCitedPercent: excerpts.length === 0 ? 0 : round1((citedIds.size / excerpts.length) * 100),
    citedTextPercent: totalText === 0 ? 0 : round1((citedText / totalText) * 100),
    largestUncitedGapSeconds: largestGap,
    coreUnitsWithoutVerifiedEvidence,
    weakQuoteCount,
  };
};
