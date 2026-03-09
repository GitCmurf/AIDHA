import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("CI Quality Gate", () => {
  it("should not regress beyond allowed tolerance against pinned baseline", () => {
    const baselinePath = path.join(__dirname, "../fixtures/eval-matrix/baseline-report.json");
    if (!fs.existsSync(baselinePath)) {
      console.warn("Baseline not found, skipping quality gate. Create a baseline-report.json to enable this test.");
      return;
    }

    const reportPath = path.join(__dirname, "../../../out/eval-matrix/reports/latest.json");
    if (!fs.existsSync(reportPath)) {
      console.warn("Latest report not found, skipping quality gate. Run matrix evaluation first.");
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
    const latest = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

    const tolerance = 1.0; // max allowed drop in dimension score

    const dimensions = ["completeness", "accuracy", "topicCoverage", "atomicity", "overallScore"];

    for (const [modelId, stats] of Object.entries(latest.modelStats)) {
      if (baseline.modelStats[modelId]) {
        for (const dim of dimensions) {
          const baselineScore = baseline.modelStats[modelId].dimensions[dim].mean;
          const latestScore = (stats as any).dimensions[dim].mean;

          if (baselineScore - latestScore > tolerance) {
            throw new Error(`Regression detected for ${modelId} on ${dim}: dropped from ${baselineScore} to ${latestScore} (tolerance: ${tolerance})`);
          }
        }
      }
    }
    expect(true).toBe(true);
  });
});
