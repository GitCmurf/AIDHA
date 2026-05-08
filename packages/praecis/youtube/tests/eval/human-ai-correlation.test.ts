import { describe, expect, it } from "vitest";
import { computeHumanAiCorrelation } from "../../src/eval/human-ai-correlation.js";

describe("human-ai correlation", () => {
  it("computes perfect positive correlation", () => {
    const human = [1, 2, 3, 4, 5];
    const ai = [10, 20, 30, 40, 50];
    const result = computeHumanAiCorrelation(human, ai);
    expect(result?.spearmanRho).toBeCloseTo(1.0);
    expect(result?.isReliable).toBe(false); // n=5 < 15
  });

  it("computes perfect negative correlation", () => {
    const human = [1, 2, 3, 4, 5];
    const ai = [5, 4, 3, 2, 1];
    const result = computeHumanAiCorrelation(human, ai);
    expect(result?.spearmanRho).toBeCloseTo(-1.0);
  });

  it("handles ties correctly", () => {
    const human = [1, 2, 2, 4];
    const ai = [1, 2, 3, 4];
    // human ranks: 1, 2.5, 2.5, 4
    // ai ranks: 1, 2, 3, 4
    const result = computeHumanAiCorrelation(human, ai);
    expect(result?.spearmanRho).toBeDefined();
    expect(result?.spearmanRho).toBeLessThan(1.0);
    expect(result?.spearmanRho).toBeGreaterThan(0.9);
  });

  it("returns undefined for constant series", () => {
    const human = [1, 2, 3];
    const ai = [5, 5, 5];
    const result = computeHumanAiCorrelation(human, ai);
    expect(result).toBeUndefined();
  });

  it("marks as reliable when n >= 15", () => {
    const human = Array.from({ length: 15 }, (_, i) => i);
    const ai = Array.from({ length: 15 }, (_, i) => i);
    const result = computeHumanAiCorrelation(human, ai);
    expect(result?.isReliable).toBe(true);
  });
});
