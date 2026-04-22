import { describe, expect, it } from "vitest";
import { buildReportFileSet, formatReportFilestamp } from "../../src/eval/report-files.js";
import { renderMatrixReport } from "../../src/eval/report-markdown.js";
import type { MatrixReport } from "../../src/eval/matrix-aggregator.js";

describe("report files and rendering", () => {
  it("formats compact ISO-style filestamps", () => {
    expect(formatReportFilestamp(new Date("2026-03-15T13:36:00Z"))).toMatch(/^\d{8}T\d{4,6}$/);
  });

  it("builds stamped report paths and latest aliases", () => {
    const files = buildReportFileSet("out/eval-matrix/reports", "Harness Test", new Date("2026-03-15T13:36:00Z"));

    expect(files.stub).toBe("harness-test");
    expect(files.filestamp).toMatch(/^\d{8}T\d{4,6}$/);
    expect(files.jsonPath).toContain("harness-test-");
    expect(files.jsonPath).toContain(".json");
    expect(files.mdPath).toContain("harness-test-");
    expect(files.latestJsonPath).toBe("out/eval-matrix/reports/latest.json");
    expect(files.latestMdPath).toBe("out/eval-matrix/reports/latest.md");
  });

  it("renderMatrixReport includes Narrow Judge Summary when data is present", () => {
    const report: Partial<MatrixReport> = {
      summary: { bestModel: "m1", worstModel: "m2", hardestVideo: "v1" },
      narrowJudgeResults: {
        "variant-a": {
          "video-1": {
            goldCoverage: 10,
            faithfulness: 9,
            structure: 8,
            atomicity: 7,
            overallScore: 8.5
          }
        }
      },
      modelStats: {},
      variantStats: {},
      videoStats: {},
      leaderboards: { overallScore: [], completeness: [], accuracy: [], topicCoverage: [], atomicity: [] },
      cells: []
    };

    const md = renderMatrixReport(report as MatrixReport);
    expect(md).toContain("## Narrow Judge Summary");
    expect(md).toContain("### Variant: variant-a");
    expect(md).toContain("video-1");
    expect(md).toContain("10.00");
    expect(md).toContain("**8.50**");
  });
});
