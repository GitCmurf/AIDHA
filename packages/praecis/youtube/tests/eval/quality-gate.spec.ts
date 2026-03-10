import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("CI Quality Gate", () => {
  it("should not regress beyond allowed tolerance against pinned baseline", (ctx) => {
    const latestPath = path.join(__dirname, "../../../out/eval-matrix/reports/latest.json");
    if (!fs.existsSync(latestPath)) {
      if (process.env.CI || process.env.REQUIRE_EVAL_GATE === "1") {
        throw new Error("Required 'latest.json' report not found. You must run 'eval matrix' before this test. See docs/55-testing/eval-matrix/baseline-workflow.md.");
      }
      ctx.skip();
      return;
    }

    // path relative to packages/praecis/youtube/tests/eval is ../../../../../out/...
    const reportPath = path.join(__dirname, "../../../../../out/eval-matrix/reports/latest.json");
    if (!fs.existsSync(reportPath)) {
      if (process.env.CI || process.env.REQUIRE_EVAL_GATE === "1") {
        throw new Error(`Latest report not found at ${reportPath}, failing quality gate. Run matrix evaluation first.`);
      }
      ctx.skip();
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
    const latest = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

    const tolerance = 1.0; // max allowed drop in dimension score

    const dimensions = ["completeness", "accuracy", "topicCoverage", "atomicity", "overallScore"];

    for (const [modelId, baselineStats] of Object.entries(baseline.modelStats)) {
      const latestStats = latest.modelStats[modelId];
      if (!latestStats) {
        throw new Error(`Model ${modelId} present in baseline but missing from latest report`);
      }

      for (const dim of dimensions) {
        const baselineScore = (baselineStats as any).dimensions[dim].mean;
        const latestScore = (latestStats as any).dimensions[dim].mean;

        if (baselineScore - latestScore > tolerance) {
          throw new Error(`Regression detected for ${modelId} on ${dim}: dropped from ${baselineScore} to ${latestScore} (tolerance: ${tolerance})`);
        }
      }
    }
    expect(true).toBe(true);
  });
});
