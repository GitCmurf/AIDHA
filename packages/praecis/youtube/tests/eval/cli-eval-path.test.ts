import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEvalMatrix } from "../../src/cli-eval";
import * as fs from "node:fs";

// Mock internal functions to prevent actual test execution
vi.mock("../../src/eval/matrix-runner", () => ({
  runEvaluationMatrix: vi.fn().mockResolvedValue({
    cells: [{
      videoId: "v1",
      modelId: "m1",
      extractorVariantId: "raw",
      claimSet: []
    }],
    metadata: { failedCellCount: 0, partialFailureCount: 0 }
  })
}));

vi.mock("../../src/eval/matrix-aggregator", () => ({
  aggregateMatrixResults: vi.fn().mockReturnValue({ cells: [{
      videoId: "v1",
      modelId: "m1",
      extractorVariantId: "raw",
      claimSet: []
    }] })
}));

vi.mock("../../src/eval/report-markdown", () => ({
  renderMatrixReport: vi.fn().mockReturnValue("mock report")
}));

vi.mock("../../src/eval/report-json", () => ({
  exportMatrixJson: vi.fn().mockReturnValue("{}")
}));

// Mock fs to track directory creation
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const mockCorpus = [1,2,3,4,5].map(i => ({
    videoId: `v${i}`,
    url: `http://v${i}`,
    title: `Video ${i}`,
    channelName: "Test",
    durationMinutes: 10,
    topicDomain: "Test",
    expectedClaimDensity: "low",
    rationale: "test"
  }));
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify(mockCorpus)),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe("CLI Export Path Resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use default output directory if no options are provided", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);

    await runEvalMatrix(["node", "matrix"], { format: "both", corpus: "test.json" }, {} as any);

    expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, "out/eval-matrix/reports", { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, "out/eval-matrix/reports/cells", { recursive: true });
  });

  it("should use run-scoped output directory if --run-id is provided", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);

    await runEvalMatrix(["node", "matrix"], { "run-id": "test-run", format: "both", corpus: "test.json" }, {} as any);

    expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, "out/eval-matrix/runs/test-run", { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, "out/eval-matrix/runs/test-run/cells", { recursive: true });
  });

  it("should prioritize explicit --output-dir over --run-id", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);

    await runEvalMatrix(
      ["node", "matrix"],
      { "run-id": "test-run", "output-dir": "custom/dir", format: "both", corpus: "test.json" },
      {} as any
    );

    expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, "custom/dir", { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, "custom/dir/cells", { recursive: true });
  });
});
