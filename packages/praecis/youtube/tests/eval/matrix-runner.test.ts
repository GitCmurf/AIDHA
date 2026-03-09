import { describe, it, expect } from "vitest";
import { runEvaluationMatrix } from "../../src/eval/matrix-runner";
import { MODEL_REGISTRY } from "../../src/eval/model-registry";
import { aggregateMatrixResults } from "../../src/eval/matrix-aggregator";
import { renderMatrixReport } from "../../src/eval/report-markdown";

describe("Matrix Runner Integration", () => {
  it("should run a 2-video x 2-model matrix and generate report", async () => {
    const corpus = [
      {
        videoId: "v1", url: "http://v1", title: "Video 1", channelName: "Channel 1",
        durationMinutes: 10, topicDomain: "Test", expectedClaimDensity: "low" as const, rationale: "test"
      },
      {
        videoId: "v2", url: "http://v2", title: "Video 2", channelName: "Channel 2",
        durationMinutes: 20, topicDomain: "Test", expectedClaimDensity: "medium" as const, rationale: "test"
      }
    ];

    const models = MODEL_REGISTRY.slice(0, 2);

    const options = {
      outputDir: "out/test",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o"],
      maxConcurrency: 1,
      timeoutMs: 1000,
    };

    const result = await runEvaluationMatrix(corpus, models, options);

    expect(result.cells.length).toBe(4); // 2 videos x 2 models x 1 variant
    for (const cell of result.cells) {
      expect(cell.scores).toBeDefined();
      expect(cell.scores!.length).toBeGreaterThan(0);
      expect(cell.scores![0].overallScore).toBeGreaterThanOrEqual(0);
    }

    const report = aggregateMatrixResults(result.cells);
    expect(report.modelStats[models[0].id]).toBeDefined();
    expect(report.videoStats["v1"]).toBeDefined();

    const md = renderMatrixReport(report);
    expect(md).toContain("Video Heatmap");
    expect(md).toContain(models[0].id);
  });
});
