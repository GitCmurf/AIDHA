import { describe, expect, it } from "vitest";
import { comparePasses } from "../../src/eval/self-improve-comparison.js";
import type { NarrowJudgeFindings } from "../../src/eval/narrow-judge.js";
import type { FlattenedGoldenClaimNode } from "../../src/eval/golden-annotation-utils.js";
import type { ClaimCandidate } from "../../src/extract/types.js";

describe("self-improve comparison", () => {
  const flattenedGold: FlattenedGoldenClaimNode[] = [
    { id: "g1", text: "Gold claim 1", depth: 0, path: [0], type: "claim" },
    { id: "g2", text: "Gold claim 2", depth: 1, path: [0, 0], type: "claim" },
  ];

  it("calculates positive delta when self-improvement covers more gold claims", () => {
    const pass1Findings: NarrowJudgeFindings = {
      summary: "Pass 1 summary",
      matchedGoldClaims: [{ goldText: "Gold claim 1", candidateText: "Cand 1", reason: "Match" }],
      missedGoldClaims: [{ goldText: "Gold claim 2", reason: "Missed" }],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    };
    const pass1Claims: ClaimCandidate[] = [{ text: "Cand 1", excerptIds: [] }];

    const selfImprovedFindings: NarrowJudgeFindings = {
      summary: "Self-Improved summary",
      matchedGoldClaims: [
        { goldText: "Gold claim 1", candidateText: "Cand 1", reason: "Match" },
        { goldText: "Gold claim 2", candidateText: "Cand 2", reason: "Improved match" },
      ],
      missedGoldClaims: [],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    };
    const selfImprovedClaims: ClaimCandidate[] = [
      { text: "Cand 1", excerptIds: [] },
      { text: "Cand 2", excerptIds: [] },
    ];

    const result = comparePasses(pass1Findings, pass1Claims, selfImprovedFindings, selfImprovedClaims, flattenedGold);

    expect(result.deltaGoldCoverage).toBeGreaterThan(0);
    expect(result.improved).toBe(true);
    expect(result.pass1.goldCoverage).toBe(5);
    expect(result.selfImproved.goldCoverage).toBe(10);
  });

  it("calculates negative delta when self-improvement degrades results", () => {
    const pass1Findings: NarrowJudgeFindings = {
      summary: "Pass 1 summary",
      matchedGoldClaims: [{ goldText: "Gold claim 1", candidateText: "Cand 1", reason: "Match" }],
      missedGoldClaims: [{ goldText: "Gold claim 2", reason: "Missed" }],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    };
    const pass1Claims: ClaimCandidate[] = [{ text: "Cand 1", excerptIds: [] }];

    const selfImprovedFindings: NarrowJudgeFindings = {
      summary: "Self-Improved summary",
      matchedGoldClaims: [],
      missedGoldClaims: [
        { goldText: "Gold claim 1", reason: "Lost match" },
        { goldText: "Gold claim 2", reason: "Missed" }
      ],
      unsupportedCandidateClaims: [{ candidateText: "Hallucination", reason: "Unsupported" }],
      redundantCandidateClaims: [],
      structuralIssues: [],
    };
    const selfImprovedClaims: ClaimCandidate[] = [
      { text: "Hallucination", excerptIds: [] },
    ];

    const result = comparePasses(pass1Findings, pass1Claims, selfImprovedFindings, selfImprovedClaims, flattenedGold);

    expect(result.deltaOverallScore).toBeLessThan(0);
    expect(result.improved).toBe(false);
  });
});
