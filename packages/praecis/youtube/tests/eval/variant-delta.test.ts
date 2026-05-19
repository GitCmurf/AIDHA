import { describe, it, expect } from "vitest";
import { computeVariantDelta } from "../../src/eval/variant-delta.js";
import type { MatrixCell } from "../../src/eval/matrix-runner.js";
import type { ClaimSetScore } from "../../src/eval/scoring-rubric.js";
import type { ExtractorVariantId } from "../../src/eval/extractor-variants.js";

const score = (judgeModelId = "judge-a", overrides: Partial<ClaimSetScore> = {}): ClaimSetScore => ({
  completeness: 8,
  accuracy: 9,
  topicCoverage: 7,
  atomicity: 8,
  overallScore: 8,
  reasoning: "Acceptable extraction.",
  missingClaims: [],
  hallucinations: [],
  redundancies: [],
  gapAreas: [],
  judgeMeta: { judgeModelId, judgePromptVersion: "v2" },
  ...overrides,
});

const legacyScore = (overrides: Partial<ClaimSetScore> = {}): ClaimSetScore => ({
  completeness: 8,
  accuracy: 9,
  topicCoverage: 7,
  atomicity: 8,
  overallScore: 8,
  reasoning: "Acceptable extraction.",
  missingClaims: [],
  hallucinations: [],
  redundancies: [],
  gapAreas: [],
  ...overrides,
});

const cell = (videoId: string, modelId: string, variant: ExtractorVariantId, scores: ClaimSetScore[]): MatrixCell => ({
  videoId,
  modelId,
  extractorVariantId: variant,
  claimSet: [],
  scores,
});

describe("computeVariantDelta", () => {
  it("computes positive delta when compare variant scores higher than base", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [score("judge-a", { completeness: 7, overallScore: 7.75 })]),
      cell("v1", "m1", "editorial-pass-v1", [score("judge-a", { completeness: 9, overallScore: 8.25 })]),
    ];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.matchedPairCount).toBe(1);
    expect(result.meanDelta.completeness).toBeCloseTo(2);
    expect(result.meanDelta.accuracy).toBeCloseTo(0);
  });

  it("averages deltas over multiple matched pairs", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [score("judge-a", { completeness: 6, overallScore: 7.5 })]),
      cell("v1", "m1", "editorial-pass-v1", [score("judge-a", { completeness: 8, overallScore: 8.5 })]),
      cell("v2", "m1", "raw", [score("judge-a", { completeness: 8, overallScore: 8 })]),
      cell("v2", "m1", "editorial-pass-v1", [score("judge-a", { completeness: 10, overallScore: 9 })]),
    ];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.matchedPairCount).toBe(2);
    expect(result.meanDelta.completeness).toBeCloseTo(2);
  });

  it("reports missingClaimsDelta (positive = compare has more missing claims)", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [score("judge-a", { missingClaims: [{ text: "A" }] })]),
      cell("v1", "m1", "editorial-pass-v1", [score("judge-a", { missingClaims: [{ text: "A" }, { text: "B" }] })]),
    ];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.meanMissingClaimsDelta).toBeCloseTo(1);
  });

  it("returns matchedPairCount 0 and zero deltas when no pairs match", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [score("judge-a")]),
    ];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.matchedPairCount).toBe(0);
    expect(result.meanDelta.completeness).toBe(0);
  });

  it("ignores cells with no scores", () => {
    const cells: MatrixCell[] = [
      { ...cell("v1", "m1", "raw", [score("judge-a")]), scores: undefined },
      cell("v1", "m1", "editorial-pass-v1", [score("judge-a")]),
    ];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.matchedPairCount).toBe(0);
  });

  it("computes hallucinationsDelta correctly", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [score("judge-a", { hallucinations: [{ text: "X" }, { text: "Y" }] })]),
      cell("v1", "m1", "editorial-pass-v1", [score("judge-a", { hallucinations: [{ text: "X" }] })]),
    ];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.meanHallucinationsDelta).toBeCloseTo(-1);
  });

  it("distinguishes cells with different promptConfigId or chunkMode", () => {
    const base1: MatrixCell = { ...cell("v1", "m1", "raw", [score("judge-a", { completeness: 6 })]), promptConfigId: "cfg-a", chunkMode: "small" };
    const base2: MatrixCell = { ...cell("v1", "m1", "raw", [score("judge-a", { completeness: 8 })]), promptConfigId: "cfg-b", chunkMode: "large" };
    const compare1: MatrixCell = { ...cell("v1", "m1", "editorial-pass-v1", [score("judge-a", { completeness: 9 })]), promptConfigId: "cfg-a", chunkMode: "small" };
    const compare2: MatrixCell = { ...cell("v1", "m1", "editorial-pass-v1", [score("judge-a", { completeness: 7 })]), promptConfigId: "cfg-b", chunkMode: "large" };
    const cells: MatrixCell[] = [base1, base2, compare1, compare2];
    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });
    expect(result.matchedPairCount).toBe(2);
    expect(result.meanDelta.completeness).toBeCloseTo(1);
  });

  it("matches deltas by judge identity when one variant has a partial scoring failure", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [
        score("judge-a", { completeness: 6, overallScore: 6.5 }),
        score("judge-b", { completeness: 2, overallScore: 2.5 }),
      ]),
      cell("v1", "m1", "editorial-pass-v1", [
        score("judge-a", { completeness: 9, overallScore: 8.5 }),
      ]),
    ];

    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });

    expect(result.matchedPairCount).toBe(1);
    expect(result.meanDelta.completeness).toBeCloseTo(3);
    expect(result.meanDelta.overallScore).toBeCloseTo(2);
  });

  it("includes scores without judge metadata in legacy/cache-compatible cells", () => {
    const cells: MatrixCell[] = [
      cell("v1", "m1", "raw", [legacyScore({ completeness: 6, overallScore: 7.5 })]),
      cell("v1", "m1", "editorial-pass-v1", [legacyScore({ completeness: 9, overallScore: 8.5 })]),
    ];

    const result = computeVariantDelta({ cells, baseVariant: "raw", compareVariant: "editorial-pass-v1" });

    expect(result.matchedPairCount).toBe(1);
    expect(result.meanDelta.completeness).toBeCloseTo(3);
    expect(result.meanDelta.overallScore).toBeCloseTo(1);
  });
});
