import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEvalMatrix } from "../../src/cli-eval";
import * as fs from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    rmSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe("Cache Invalidation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should clear specific run cache directory when --invalidate-run <runId> is used", async () => {
    const existsSyncMock = vi.mocked(fs.existsSync);
    const rmSyncMock = vi.mocked(fs.rmSync);

    existsSyncMock.mockImplementation((path) => {
      const p = String(path);
      if (p === ".cache/extraction") return true;
      if (p === ".cache/extraction/test-run-123") return true;
      return false;
    });

    const result = await runEvalMatrix(
      ["node", "matrix"],
      { "invalidate-run": "test-run-123" },
      {} as any
    );

    expect(result).toBe(0);
    expect(rmSyncMock).toHaveBeenCalledWith(".cache/extraction/test-run-123", { recursive: true, force: true });
    expect(rmSyncMock).not.toHaveBeenCalledWith(".cache/extraction", { recursive: true, force: true });
  });

  it("should clear the entire cache when --clear-all and --yes are used", async () => {
    const existsSyncMock = vi.mocked(fs.existsSync);
    const rmSyncMock = vi.mocked(fs.rmSync);

    existsSyncMock.mockImplementation((path) => {
      const p = String(path);
      if (p === ".cache/extraction") return true;
      return false;
    });

    const result = await runEvalMatrix(
      ["node", "matrix"],
      { "clear-all": true, "yes": true },
      {} as any
    );

    expect(result).toBe(0);
    expect(rmSyncMock).toHaveBeenCalledWith(".cache/extraction", { recursive: true, force: true });
  });
});
