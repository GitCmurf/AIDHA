import { describe, it, expect } from "vitest";
import { CalibrationRecordSchema } from "../../src/eval/calibration-schema.js";
import { GoldenAnnotationSchema } from "../../src/eval/golden-annotation-schema.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CALIBRATION_PATH = join(__dirname, "../fixtures/eval-matrix/calibration/calibration-record-v1.json");
const GOLDEN_PATH = join(__dirname, "../fixtures/eval-matrix/golden-annotations.json");

describe("calibration-record-v1.json fixture", () => {
  it("validates against CalibrationRecordSchema", () => {
    const data = JSON.parse(readFileSync(CALIBRATION_PATH, "utf-8"));
    const result = CalibrationRecordSchema.safeParse(data);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.format(), null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("references only videoIds present in golden-annotations.json", () => {
    const calibration = JSON.parse(readFileSync(CALIBRATION_PATH, "utf-8"));
    const golden = GoldenAnnotationSchema.parse(JSON.parse(readFileSync(GOLDEN_PATH, "utf-8")));
    const goldenIds = new Set(golden.map(e => e.videoId));
    for (const videoId of calibration.goldSetVideoIds) {
      expect(goldenIds.has(videoId), `${videoId} not found in golden-annotations.json`).toBe(true);
    }
  });

  it("has overallPassed consistent with perVideoResults", () => {
    const data = CalibrationRecordSchema.parse(JSON.parse(readFileSync(CALIBRATION_PATH, "utf-8")));
    const allPassed = data.perVideoResults.every(r => r.passed);
    expect(data.overallPassed).toBe(allPassed);
  });
});
