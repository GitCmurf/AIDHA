import { describe, it, expect } from "vitest";
import { CalibrationRecordSchema } from "../../src/eval/calibration-schema.js";

const validRecord = {
  promptVersion: "v1",
  judgeModelId: "gpt-4o-mini",
  runDate: "2026-05-14",
  agreementThreshold: 0.7,
  goldSetVideoIds: ["synthetic-lecture-1"],
  perVideoResults: [
    {
      videoId: "synthetic-lecture-1",
      humanScore: { completeness: 10, accuracy: 10, topicCoverage: 10, atomicity: 10, overallScore: 10 },
      judgeScore: { completeness: 8.5, accuracy: 9.0, topicCoverage: 8.0, atomicity: 9.5, overallScore: 8.75 },
      deltas: { completeness: -1.5, accuracy: -1.0, topicCoverage: -2.0, atomicity: -0.5, overallScore: -1.25 },
      agreements: { completeness: 0.85, accuracy: 0.90, topicCoverage: 0.80, atomicity: 0.95, overallScore: 0.875 },
      passed: true,
    },
  ],
  aggregateAgreement: { completeness: 0.85, accuracy: 0.90, topicCoverage: 0.80, atomicity: 0.95, overallScore: 0.875 },
  overallPassed: true,
};

describe("CalibrationRecordSchema", () => {
  it("accepts a valid calibration record", () => {
    expect(CalibrationRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it("rejects missing promptVersion", () => {
    const { promptVersion: _, ...rest } = validRecord;
    expect(CalibrationRecordSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects agreementThreshold outside 0–1 range", () => {
    expect(CalibrationRecordSchema.safeParse({ ...validRecord, agreementThreshold: 1.5 }).success).toBe(false);
    expect(CalibrationRecordSchema.safeParse({ ...validRecord, agreementThreshold: -0.1 }).success).toBe(false);
  });

  it("rejects empty goldSetVideoIds", () => {
    expect(CalibrationRecordSchema.safeParse({ ...validRecord, goldSetVideoIds: [] }).success).toBe(false);
  });

  it("rejects perVideoResult with invalid agreement value (>1)", () => {
    const bad = {
      ...validRecord,
      perVideoResults: [{
        ...validRecord.perVideoResults[0],
        agreements: { completeness: 1.1, accuracy: 0.9, topicCoverage: 0.8, atomicity: 0.9, overallScore: 0.9 }
      }]
    };
    expect(CalibrationRecordSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts optional notes field", () => {
    expect(CalibrationRecordSchema.safeParse({ ...validRecord, notes: "First calibration run." }).success).toBe(true);
  });

  it("rejects runDate in wrong format", () => {
    expect(CalibrationRecordSchema.safeParse({ ...validRecord, runDate: "14/05/2026" }).success).toBe(false);
  });

  it("rejects humanScore values out of 0–10 range", () => {
    const bad = {
      ...validRecord,
      perVideoResults: [{
        ...validRecord.perVideoResults[0],
        humanScore: { completeness: 11, accuracy: 10, topicCoverage: 10, atomicity: 10, overallScore: 10 }
      }]
    };
    expect(CalibrationRecordSchema.safeParse(bad).success).toBe(false);
  });
});
