import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCORE_DIMENSIONS, type ScoreDimension } from "../../src/eval/scoring-rubric";
import type { MatrixReport } from "../../src/eval/matrix-aggregator";
import { getDimensionMean } from "../../src/eval/matrix-aggregator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("CI Quality Gate", () => {
  it("should not regress beyond allowed tolerance against pinned baseline", (ctx) => {
    // Path relative to packages/praecis/youtube/tests/eval is ../../../../../out/...
    const reportPath = join(__dirname, "../../../../../out/eval-matrix/reports/latest.json");
    const baselinePath = join(__dirname, "../../../../../out/eval-matrix/reports/baseline.json");

    let baseline: MatrixReport | null, latest: MatrixReport | null;
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
    } catch {
      if (process.env.CI || process.env.REQUIRE_EVAL_GATE === "1") {
        throw new Error(`Required 'baseline.json' report not found at ${baselinePath}, failing quality gate. Run matrix evaluation and pin a baseline first.`);
      }
      ctx.skip();
      return;
    }

    try {
      latest = JSON.parse(readFileSync(reportPath, "utf-8"));
    } catch {
      if (process.env.CI || process.env.REQUIRE_EVAL_GATE === "1") {
        throw new Error(`Required 'latest.json' report not found at ${reportPath}. You must run 'eval matrix' before this test. See docs/55-testing/eval-matrix/baseline-workflow.md.`);
      }
      ctx.skip();
      return;
    }

    if (!baseline?.modelStats || !latest?.modelStats) {
      throw new Error("Report files missing modelStats data");
    }

    const tolerance = 1.0; // max allowed drop in dimension score

    for (const [modelId, baselineStats] of Object.entries(baseline.modelStats)) {
      const latestStats = latest.modelStats[modelId];
      if (!latestStats) {
        throw new Error(`Model ${modelId} present in baseline but missing from latest report`);
      }

      for (const dim of SCORE_DIMENSIONS) {
        const baselineScore = getDimensionMean(baselineStats, dim);
        const latestScore = getDimensionMean(latestStats, dim);

        if (baselineScore - latestScore > tolerance) {
          throw new Error(`Regression detected for ${modelId} on ${dim}: dropped from ${baselineScore} to ${latestScore} (tolerance: ${tolerance})`);
        }
      }
    }
    expect(true).toBe(true);
  });
});
