import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCORE_DIMENSIONS, type ScoreDimension } from "../../src/eval/scoring-rubric";
import type { MatrixReport } from "../../src/eval/matrix-aggregator";
import { getDimensionMean } from "../../src/eval/matrix-aggregator";

interface EvalReport {
  summary: { bestModel: string; worstModel: string; hardestVideo: string };
  modelStats: Record<string, { dimensions: Record<string, { mean: number; median: number; min: number; max: number; stddev: number }> }>;
}

function readJsonFile(filePath: string): { data: EvalReport | null; errorType: 'ENOENT' | 'PARSE' | null } {
  try {
    const data = readFileSync(filePath, "utf-8");
    try {
      return { data: JSON.parse(data) as EvalReport, errorType: null };
    } catch {
      return { data: null, errorType: 'PARSE' };
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { data: null, errorType: 'ENOENT' };
    }
    throw err;
  }
}

/**
 * Checks if the quality gate should fail when a required report is missing.
 * Throws an error if REQUIRE_EVAL_GATE is set to "1", otherwise allows skipping.
 * @param filePath - The path to the missing report
 * @param reportType - The type of report for the error message
 */
function checkRequiredEvalGate(filePath: string, reportType: string): void {
  if (process.env.REQUIRE_EVAL_GATE === "1") {
    throw new Error(`Required '${reportType}' report not found at ${filePath}. Run matrix evaluation and pin a baseline first.`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("CI Quality Gate", () => {
  it("should not regress beyond allowed tolerance against pinned baseline", (ctx) => {
    // Path relative to packages/praecis/youtube/tests/eval is ../../../../../out/...
    const reportPath = join(__dirname, "../../../../../out/eval-matrix/reports/latest.json");
    const baselinePath = join(__dirname, "../../../../../out/eval-matrix/reports/baseline.json");

    let baseline: MatrixReport | null, latest: MatrixReport | null;
    const baselineResult = readJsonFile(baselinePath);
    if (baselineResult.errorType === 'PARSE') {
      throw new Error(`Corrupt baseline report at ${baselinePath}`);
    }
    if (baselineResult.errorType === 'ENOENT') {
      checkRequiredEvalGate(baselinePath, 'baseline.json');
      ctx.skip();
      return;
    }
    baseline = baselineResult.data as MatrixReport;

    const latestResult = readJsonFile(reportPath);
    if (latestResult.errorType === 'PARSE') {
      throw new Error(`Corrupt report at ${reportPath}`);
    }
    if (latestResult.errorType === 'ENOENT') {
      checkRequiredEvalGate(reportPath, 'latest.json');
      ctx.skip();
      return;
    }
    latest = latestResult.data as MatrixReport;

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
