import { describe, expect, it } from "vitest";
import { buildReportFileSet, formatReportFilestamp } from "../../src/eval/report-files";

describe("report file naming", () => {
  it("formats compact ISO-style filestamps", () => {
    expect(formatReportFilestamp(new Date("2026-03-15T13:36:00Z"))).toMatch(/^\d{8}T\d{4}$/);
  });

  it("builds stamped report paths and latest aliases", () => {
    const files = buildReportFileSet("out/eval-matrix/reports", "Harness Test", new Date("2026-03-15T13:36:00Z"));

    expect(files.stub).toBe("harness-test");
    expect(files.filestamp).toMatch(/^\d{8}T\d{4}$/);
    expect(files.jsonPath).toContain("harness-test-");
    expect(files.jsonPath).toContain(".json");
    expect(files.mdPath).toContain("harness-test-");
    expect(files.latestJsonPath).toBe("out/eval-matrix/reports/latest.json");
    expect(files.latestMdPath).toBe("out/eval-matrix/reports/latest.md");
  });
});
