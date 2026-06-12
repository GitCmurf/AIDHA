import { describe, expect, it } from 'vitest';
import { computeCoverage, type CoverageExcerpt } from '../../../src/extract/distill/coverage.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

const excerpts: CoverageExcerpt[] = [
  { id: 'ex1', text: 'a'.repeat(100), startSec: 0, endSec: 60 },
  { id: 'ex2', text: 'b'.repeat(100), startSec: 60, endSec: 120 },
  { id: 'ex3', text: 'c'.repeat(200), startSec: 120, endSec: 300 },
  { id: 'ex4', text: 'd'.repeat(100), startSec: 300, endSec: 360 },
];

function verifiedUnit(id: string, excerptId: string, status: 'exact' | 'failed', importance: 'core' | 'supporting' = 'core'): VerifiedUnit {
  return {
    id,
    kind: 'idea',
    text: 'A standalone canonical idea sentence that is long enough.',
    stance: 'asserted',
    importance,
    evidence: [{ excerptId, quote: 'irrelevant for coverage tests', quoteVerification: status }],
  };
}

describe('computeCoverage', () => {
  it('computes cited excerpt and text percentages', () => {
    const coverage = computeCoverage([verifiedUnit('u1', 'ex1', 'exact'), verifiedUnit('u2', 'ex3', 'exact')], excerpts);
    expect(coverage.citedExcerptCount).toBe(2);
    expect(coverage.excerptsCitedPercent).toBe(50);
    expect(coverage.citedTextPercent).toBe(60); // (100 + 200) / 500
  });

  it('finds the largest uncited time gap', () => {
    const coverage = computeCoverage([verifiedUnit('u1', 'ex1', 'exact'), verifiedUnit('u2', 'ex4', 'exact')], excerpts);
    expect(coverage.largestUncitedGapSeconds).toBe(240); // ex2 (60-120) + ex3 (120-300)
  });

  it('counts core units lacking verified evidence', () => {
    const coverage = computeCoverage([verifiedUnit('u1', 'ex1', 'failed')], excerpts);
    expect(coverage.coreUnitsWithoutVerifiedEvidence).toBe(1);
  });

  it('handles empty units', () => {
    const coverage = computeCoverage([], excerpts);
    expect(coverage.excerptsCitedPercent).toBe(0);
    expect(coverage.largestUncitedGapSeconds).toBe(360);
  });

  it('handles out-of-order excerpts when finding the largest gap', () => {
    const unordered: CoverageExcerpt[] = [
      { id: 'ex3', text: 'c'.repeat(200), startSec: 120, endSec: 300 },
      { id: 'ex1', text: 'a'.repeat(100), startSec: 0, endSec: 60 },
      { id: 'ex2', text: 'b'.repeat(100), startSec: 60, endSec: 120 },
    ];
    // ex1 cited; ex2+ex3 uncited and contiguous after sorting => gap 60..300 = 240
    const coverage = computeCoverage([verifiedUnit('u1', 'ex1', 'exact')], unordered);
    expect(coverage.largestUncitedGapSeconds).toBe(240);
  });

  it('handles nested excerpts without shrinking the run end', () => {
    const nested: CoverageExcerpt[] = [
      { id: 'ex1', text: 'a'.repeat(100), startSec: 0, endSec: 100 },
      { id: 'ex2', text: 'b'.repeat(10), startSec: 50, endSec: 60 },
      { id: 'ex3', text: 'c'.repeat(100), startSec: 100, endSec: 160 },
    ];
    // ex3 cited; ex1+ex2 uncited; run covers 0..100 despite ex2 ending earlier
    const coverage = computeCoverage([verifiedUnit('u1', 'ex3', 'exact')], nested);
    expect(coverage.largestUncitedGapSeconds).toBe(100);
  });

  it('ignores non-timecoded excerpts in gap computation but still counts their citation', () => {
    const mixed: CoverageExcerpt[] = [
      { id: 'ex1', text: 'a'.repeat(100), startSec: 0, endSec: 60 },
      { id: 'exN', text: 'n'.repeat(100) },
      { id: 'ex2', text: 'b'.repeat(100), startSec: 60, endSec: 120 },
    ];
    const coverage = computeCoverage([verifiedUnit('u1', 'exN', 'exact')], mixed);
    expect(coverage.largestUncitedGapSeconds).toBe(120); // ex1+ex2 contiguous uncited
    expect(coverage.citedExcerptCount).toBe(1);
  });
});
