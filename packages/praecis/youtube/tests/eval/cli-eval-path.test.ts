import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEvalMatrix } from "../../src/cli-eval";
import { aggregateMatrixResults } from "../../src/eval/matrix-aggregator";
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

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fileHandle = {
    sync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;

  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(fileHandle),
  };
});

describe("CLI Export Path Resolution", () => {
  const mockConfig = {
    llm: {
      model: "gpt-4o-mini",
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "",
      timeoutMs: 1000,
      cacheDir: "test-cache",
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use default output directory if no options are provided", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);

    await runEvalMatrix(["node", "matrix"], { format: "both", corpus: "test.json" }, mockConfig);

    expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, "out/eval-matrix/reports", { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, "out/eval-matrix/reports/cells", { recursive: true });
  });

  it("should use run-scoped output directory if --run-id is provided", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);

    await runEvalMatrix(["node", "matrix"], { "run-id": "test-run", format: "both", corpus: "test.json" }, mockConfig);

    expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, "out/eval-matrix/runs/test-run", { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, "out/eval-matrix/runs/test-run/cells", { recursive: true });
  });

  it("should prioritize explicit --output-dir over --run-id", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);

    await runEvalMatrix(
      ["node", "matrix"],
      { "run-id": "test-run", "output-dir": "custom/dir", format: "both", corpus: "test.json" },
      mockConfig
    );

    expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, "custom/dir", { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, "custom/dir/cells", { recursive: true });
  });

  it("returns failure when the self-improvement quality gate fails", async () => {
    vi.mocked(aggregateMatrixResults).mockReturnValueOnce({
      cells: [
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "editorial-pass-v1",
          consensusScore: {
            mean: {
              completeness: 4.0,
              accuracy: 4.5,
              topicCoverage: 4.0,
              atomicity: 4.0,
              overallScore: 4.0,
            },
          },
        },
        {
          videoId: "v1",
          modelId: "m1",
          extractorVariantId: "self-improve-v1",
          consensusScore: {
            mean: {
              completeness: 2.0,
              accuracy: 4.5,
              topicCoverage: 4.0,
              atomicity: 4.0,
              overallScore: 4.0,
            },
          },
        },
      ],
    } as any);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const exitCode = await runEvalMatrix(["node", "matrix"], { format: "both", corpus: "test.json" }, mockConfig);

    expect(exitCode).toBe(1);
    expect(consoleWarnSpy.mock.calls.some((call) =>
      String(call[0]).includes("Self-improvement quality gate failed")
    )).toBe(true);
    consoleWarnSpy.mockRestore();
  });

  it("should support narrow-manual-baseline dry-run without writing reports", async () => {
    const mkdirSyncMock = vi.mocked(fs.mkdirSync);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runEvalMatrix(
      ["node", "narrow-manual-baseline"],
      { "dry-run": true, corpus: "test.json" },
      mockConfig
    );

    expect(exitCode).toBe(0);
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.some((call) =>
      String(call[0]).includes("Judge Models: none")
    )).toBe(true);
    expect(consoleLogSpy.mock.calls.some((call) =>
      String(call[0]).includes("Mode: fast-triage")
    )).toBe(true);
    expect(consoleLogSpy.mock.calls.some((call) =>
      String(call[0]).includes("Manual Baselines: false")
    )).toBe(true);
    expect(consoleLogSpy.mock.calls.some((call) =>
      String(call[0]).includes("Refresh Stage: none")
    )).toBe(true);

    consoleLogSpy.mockRestore();
  });
});
