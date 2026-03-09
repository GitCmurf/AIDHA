import { describe, it, expect } from "vitest";
import { ClaimSetScoreSchema } from "../../src/eval/scoring-rubric";

describe("Scoring Rubric Schema", () => {
  const validScore = {
    completeness: 8,
    accuracy: 9,
    topicCoverage: 7,
    atomicity: 10,
    overallScore: 8.5,
    reasoning: "The extraction is mostly complete but missed a few secondary points.",
    missingClaims: [{ text: "Missed the point about sleep." }],
    hallucinations: [],
    redundancies: [],
    gapAreas: [{ area: "Sleep" }],
  };

  it("should validate a completely valid score object", () => {
    const result = ClaimSetScoreSchema.safeParse(validScore);
    expect(result.success).toBe(true);
  });

  it("should reject scores out of 0-10 range", () => {
    const invalidScore = { ...validScore, completeness: 11 };
    const result = ClaimSetScoreSchema.safeParse(invalidScore);
    expect(result.success).toBe(false);
  });

  it("should reject negative scores", () => {
    const invalidScore = { ...validScore, accuracy: -1 };
    const result = ClaimSetScoreSchema.safeParse(invalidScore);
    expect(result.success).toBe(false);
  });

  it("should require a reasoning string of at least 10 chars", () => {
    const invalidScore = { ...validScore, reasoning: "Short" };
    const result = ClaimSetScoreSchema.safeParse(invalidScore);
    expect(result.success).toBe(false);
  });

  it("should validate with empty arrays for missing/hallucinations/redundancies/gapAreas", () => {
    const validWithEmpty = { ...validScore, missingClaims: [], gapAreas: [] };
    const result = ClaimSetScoreSchema.safeParse(validWithEmpty);
    expect(result.success).toBe(true);
  });

  it("should validate scores at the 0 boundary", () => {
    const boundaryScore = { ...validScore, completeness: 0, accuracy: 0, topicCoverage: 0, atomicity: 0, overallScore: 0 };
    const result = ClaimSetScoreSchema.safeParse(boundaryScore);
    expect(result.success).toBe(true);
  });

  it("should validate scores at the 10 boundary", () => {
    const boundaryScore = { ...validScore, completeness: 10, accuracy: 10, topicCoverage: 10, atomicity: 10, overallScore: 10 };
    const result = ClaimSetScoreSchema.safeParse(boundaryScore);
    expect(result.success).toBe(true);
  });

  it("should reject if required arrays are missing", () => {
    const { missingClaims, ...rest } = validScore;
    const result = ClaimSetScoreSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
