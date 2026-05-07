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

  it("should skip cells when scoring data is missing for both narrow judge and consensus", () => {
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
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
  });

  it("should warn when the baseline is scored but the self-improve cell has no score data", () => {
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
              accuracy: 4.0,
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
          claimSet: []
        }
      ]
    } as MatrixReport;

    const result = checkSelfImprovementGate(report);

    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe("missing-self-improvement-score");
  });

  it("should warn when comparable cells use different score sources", () => {
    const report = {
      ...mockReportBase,
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 9,
              faithfulness: 9,
              structure: 9,
              atomicity: 9,
              overallScore: 9
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          consensusScore: {
            mean: {
              completeness: 5,
              accuracy: 5,
              topicCoverage: 5,
              atomicity: 5,
              overallScore: 5
            }
          }
        }
      ]
    } as any as MatrixReport;

    const result = checkSelfImprovementGate(report);

    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe("incompatible-score-mode");
  });

  it("should warn when the baseline cell has no score but self-improve is scored", () => {
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
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 9,
              faithfulness: 9,
              structure: 9,
              atomicity: 9,
              overallScore: 9
            }
          }
        }
      ]
    } as any as MatrixReport;

    const result = checkSelfImprovementGate(report);

    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe("incomparable-baseline-score");
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
              goldCoverage: 8,
              faithfulness: 9,
              structure: 7,
              atomicity: 8,
              overallScore: 8
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 8.5,
              faithfulness: 9.5,
              structure: 7.5,
              atomicity: 8.5,
              overallScore: 8.5
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
              goldCoverage: 8,
              faithfulness: 9,
              structure: 7,
              atomicity: 8,
              overallScore: 8
            }
          }
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          narrowJudgeResult: {
            derivedScores: {
              goldCoverage: 6.5,
              faithfulness: 9,
              structure: 7,
              atomicity: 8,
              overallScore: 8
            }
          }
        }
      ]
    } as any as MatrixReport;

    const result = checkSelfImprovementGate(report, { tolerance: 1.0 });
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
              completeness: 2.0,
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

  it("should warn when baseline variant is present but missing for a specific video", () => {
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
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
    const missingBaseline = result.warnings.filter(w => w.reason === "missing-baseline");
    expect(missingBaseline).toHaveLength(1);
    expect(missingBaseline[0].entityId).toContain("v2");
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
              goldCoverage: 9,
              faithfulness: 9,
              structure: 9,
              atomicity: 9,
              overallScore: 9
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
              faithfulness: 9,
              structure: 9,
              atomicity: 9,
              overallScore: 9
            }
          }
        }
      ]
    } as any as MatrixReport;

    const result = checkSelfImprovementGate(report, { tolerance: 1.0 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].dimension).toBe("goldCoverage");
    expect(result.regressions[0].latestScore).toBe(0);
  });
});
