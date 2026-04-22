import { describe, expect, it } from "vitest";
import { checkSelfImprovementGate } from "../../src/eval/quality-gate.js";
import type { MatrixReport } from "../../src/eval/matrix-aggregator.js";

describe("checkSelfImprovementGate", () => {
  const mockReportTemplate: Partial<MatrixReport> = {
    summary: { bestModel: "m1", worstModel: "m2", hardestVideo: "v1" },
    leaderboards: { overallScore: [], completeness: [], accuracy: [], topicCoverage: [], atomicity: [] },
    modelStats: {},
    variantStats: {},
    videoStats: {},
  };

  it("passes when self-improvement is within tolerance", () => {
    const report: MatrixReport = {
      ...mockReportTemplate,
      cells: [
        {
          videoId: "v1", modelId: "m1", extractorVariantId: "editorial-pass-v2",
          claimSet: [], consensusScore: { mean: { overallScore: 8.0, completeness: 8, accuracy: 8, topicCoverage: 8, atomicity: 8 }, variance: {}, isHighVariance: false }
        },
        {
          videoId: "v1", modelId: "m1", extractorVariantId: "self-improve-v1",
          claimSet: [], consensusScore: { mean: { overallScore: 7.5, completeness: 7, accuracy: 8, topicCoverage: 7, atomicity: 8 }, variance: {}, isHighVariance: false }
        },
      ]
    } as MatrixReport;

    const result = checkSelfImprovementGate(report, { tolerance: 1.0 });
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
  });

  it("fails when self-improvement regresses beyond tolerance", () => {
    const report: MatrixReport = {
      ...mockReportTemplate,
      cells: [
        {
          videoId: "v1", modelId: "m1", extractorVariantId: "editorial-pass-v2",
          claimSet: [], consensusScore: { mean: { overallScore: 8.0, completeness: 8, accuracy: 8, topicCoverage: 8, atomicity: 8 }, variance: {}, isHighVariance: false }
        },
        {
          videoId: "v1", modelId: "m1", extractorVariantId: "self-improve-v1",
          claimSet: [], consensusScore: { mean: { overallScore: 6.5, completeness: 6, accuracy: 7, topicCoverage: 6, atomicity: 7 }, variance: {}, isHighVariance: false }
        },
      ]
    } as MatrixReport;

    const result = checkSelfImprovementGate(report, { tolerance: 1.0 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]?.entityId).toBe("v1/m1");
  });

  it("skips when self-improvement cells are missing", () => {
    const report: MatrixReport = {
      ...mockReportTemplate,
      cells: [
        {
          videoId: "v1", modelId: "m1", extractorVariantId: "editorial-pass-v2",
          claimSet: [], consensusScore: { mean: { overallScore: 8.0, completeness: 8, accuracy: 8, topicCoverage: 8, atomicity: 8 }, variance: {}, isHighVariance: false }
        },
      ]
    } as MatrixReport;

    const result = checkSelfImprovementGate(report);
    expect(result.skipped).toBe(true);
  });

  it("fails when baseline cells are missing for self-improvement candidates", () => {
    const report: MatrixReport = {
      ...mockReportTemplate,
      cells: [
        {
          videoId: "v1", modelId: "m1", extractorVariantId: "self-improve-v1",
          claimSet: [], consensusScore: { mean: { overallScore: 7.5, completeness: 7, accuracy: 8, topicCoverage: 7, atomicity: 8 }, variance: {}, isHighVariance: false }
        },
      ]
    } as MatrixReport;

    const result = checkSelfImprovementGate(report);
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/Missing baseline/);
  });
});
