import { describe, it, expect } from "vitest";
import { checkSelfImprovementGate } from "../../src/eval/quality-gate.js";
import type { MatrixReport } from "../../src/eval/matrix-aggregator.js";

describe("checkSelfImprovementGate", () => {
  const mockReportBase: Partial<MatrixReport> = {
    cells: []
  };

  it("should skip if no self-improve cells are found", () => {
    const report = { ...mockReportBase, cells: [] } as MatrixReport;
    const result = checkSelfImprovementGate(report);
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("should skip when baseline variant is absent from the matrix entirely", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          claimSet: []
        }
      ]
    } as MatrixReport;
    const result = checkSelfImprovementGate(report);
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
  });

  it("should fail if scoring data is missing for both narrow judge and consensus", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          claimSet: []
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          claimSet: []
        }
      ]
    } as MatrixReport;
    const result = checkSelfImprovementGate(report);
    expect(result.passed).toBe(false);
    expect(result.regressions.some(r => r.dimension === "missing-scoring-data")).toBe(true);
  });

  it("should pass if no regressions are found via narrow judge scores", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 0.8,
              faithfulness: 0.9,
              structure: 0.7,
              atomicity: 0.8,
              overallScore: 0.8
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 0.85,
              faithfulness: 0.95,
              structure: 0.75,
              atomicity: 0.85,
              overallScore: 0.85
            }
          }
        }
      ]
    } as any as MatrixReport;
    const result = checkSelfImprovementGate(report);
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
  });

  it("should detect regressions via narrow judge scores", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 0.8,
              faithfulness: 0.9,
              structure: 0.7,
              atomicity: 0.8,
              overallScore: 0.8
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 0.5, // regression > 1.0 (wait, tolerance is 1.0? That's huge if scores are 0-1)
              faithfulness: 0.9,
              structure: 0.7,
              atomicity: 0.8,
              overallScore: 0.8
            }
          }
        }
      ]
    } as any as MatrixReport;

    // Using small tolerance to detect the 0.3 drop
    const result = checkSelfImprovementGate(report, { tolerance: 0.1 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].dimension).toBe("goldCoverage");
  });

  it("should pass if no regressions are found via consensus scores", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          consensusScore: {
            mean: {
              completeness: 4.0,
              accuracy: 4.5,
              topicCoverage: 4.0,
              atomicity: 4.0,
              overallScore: 4.0
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          consensusScore: {
            mean: {
              completeness: 4.5,
              accuracy: 4.6,
              topicCoverage: 4.2,
              atomicity: 4.1,
              overallScore: 4.3
            }
          }
        }
      ]
    } as any as MatrixReport;
    const result = checkSelfImprovementGate(report);
    expect(result.passed).toBe(true);
  });

  it("should detect regressions via consensus scores", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          consensusScore: {
            mean: {
              completeness: 4.0,
              accuracy: 4.5,
              topicCoverage: 4.0,
              atomicity: 4.0,
              overallScore: 4.0
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          consensusScore: {
            mean: {
              completeness: 2.0, // regression > 1.0
              accuracy: 4.5,
              topicCoverage: 4.0,
              atomicity: 4.0,
              overallScore: 4.0
            }
          }
        }
      ]
    } as any as MatrixReport;
    const result = checkSelfImprovementGate(report, { tolerance: 1.0 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].dimension).toBe("completeness");
  });

  it("should respect tolerance boundary conditions", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          consensusScore: { mean: { overallScore: 4.0 } }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          consensusScore: { mean: { overallScore: 3.0 } }
        }
      ]
    } as any as MatrixReport;

    // 4.0 - 3.0 = 1.0. If tolerance is 1.0, it should pass (as it checks > tolerance)
    const result = checkSelfImprovementGate(report, { tolerance: 1.0 });
    expect(result.passed).toBe(true);

    // If tolerance is 0.9, it should fail
    const result2 = checkSelfImprovementGate(report, { tolerance: 0.9 });
    expect(result2.passed).toBe(false);
  });

  it("should report missing-baseline regression when baseline variant is present but missing for a specific video", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          claimSet: []
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          claimSet: []
        },
        {
          videoId: "v2",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          claimSet: []
        }
      ]
    } as MatrixReport;
    const result = checkSelfImprovementGate(report);
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(2);
    const missingBaseline = result.regressions.filter(r => r.dimension === "missing-baseline");
    expect(missingBaseline).toHaveLength(1);
    expect(missingBaseline[0].entityId).toContain("v2");
    const missingScoring = result.regressions.filter(r => r.dimension === "missing-scoring-data");
    expect(missingScoring).toHaveLength(1);
  });

  it("should treat NaN narrow judge scores as zero during regression checks", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 0.9,
              faithfulness: 0.9,
              structure: 0.9,
              atomicity: 0.9,
              overallScore: 0.9
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: Number.NaN,
              faithfulness: 0.9,
              structure: 0.9,
              atomicity: 0.9,
              overallScore: 0.9
            }
          }
        }
      ]
    } as any as MatrixReport;

    const result = checkSelfImprovementGate(report, { tolerance: 0.1 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].dimension).toBe("goldCoverage");
    expect(result.regressions[0].latestScore).toBe(0);
  });
});
