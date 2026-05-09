import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { basename } from "node:path";
import { runEvaluationMatrix } from "../../src/eval/matrix-runner";
import { getModel } from "../../src/eval/model-registry";
import { aggregateMatrixResults } from "../../src/eval/matrix-aggregator";
import { renderMatrixReport } from "../../src/eval/report-markdown";
import type { LlmClient } from "../../src/extract/llm-client";
import * as matrixCache from "../../src/eval/matrix-cache";
import { BufferedLogger } from "../../src/utils/logger";

vi.mock("node:fs");
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(),
  writeFile: vi.fn().mockResolvedValue(),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
}));
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
}));

const mockExtractionDelaysByVideoId = new Map<string, number>();
let activeProviderCalls = 0;
let maxActiveProviderCalls = 0;

const trackActiveProviderCall = async <T>(fn: () => Promise<T>): Promise<T> => {
  activeProviderCalls++;
  maxActiveProviderCalls = Math.max(maxActiveProviderCalls, activeProviderCalls);
  try {
    return await fn();
  } finally {
    activeProviderCalls--;
  }
};

const makeMockClaim = () => ({
  text: "Mock claim",
  excerptIds: ["excerpt-1"],
  startSeconds: 0,
  type: "Fact",
  classification: "Fact",
  domain: "Test",
  confidence: 1,
  why: "reason",
});

vi.mock("../../src/extract/llm-claims", () => ({
  LlmClaimExtractor: vi.fn().mockImplementation(() => ({
    extractClaims: vi.fn().mockImplementation(async (input: { resource: { id?: string } }) =>
      trackActiveProviderCall(async () => {
        const resourceId = input.resource.id ?? "";
        const videoId = resourceId.startsWith("youtube-") ? resourceId.slice("youtube-".length) : resourceId;
        const delayMs = mockExtractionDelaysByVideoId.get(videoId) ?? 0;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return [makeMockClaim()];
      })
    ),
    getLastTraces: vi.fn().mockReturnValue([{ prompt: { system: "s", user: "u" }, response: "r" }]),
    getLastRunStats: vi.fn().mockReturnValue({
      transportRetryCount: 0,
      fallbackChunkCount: 0,
      transientFailureCount: 0,
      clientTimeoutCount: 0,
      upstreamAbortCount: 0,
      maxChunkInputTokens: 100,
      selfImproveRoundCount: 0,
      promptPackId: "generic-hierarchy",
      routeSource: "fallback-default",
      retryTriggered: false,
    })
  }))
}));

vi.mock("../../src/eval/matrix-cache", async () => {
  const actual = await vi.importActual<typeof import("../../src/eval/matrix-cache")>("../../src/eval/matrix-cache");
  return {
    ...actual,
    getCachedScore: vi.fn().mockResolvedValue(null),
  };
});

describe("Matrix Runner Integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(matrixCache.getCachedScore).mockResolvedValue(null);
    mockExtractionDelaysByVideoId.clear();
    activeProviderCalls = 0;
    maxActiveProviderCalls = 0;
  });

  const createTestVideo = (
    id: string,
    duration: number,
    density: "low" | "medium" | "high"
  ) => ({
    videoId: id,
    url: `http://${id}`,
    title: `Video ${id.replace("v", "")}`,
    channelName: `Channel ${id.replace("v", "")}`,
    durationMinutes: duration,
    topicDomain: "Test",
    expectedClaimDensity: density as const,
    rationale: "test",
  });

  // Shared helper for creating mock transcript data
  const mockTranscriptImplementation = (filePath: string | URL | number): string => {
    const pathStr = typeof filePath === "string" ? filePath : String(filePath);
    // Extract videoId from path like "out/test/transcripts/v5.json"
    const videoId = basename(pathStr, ".json");
    return JSON.stringify({
      videoId,
      language: "en",
      segments: [{ start: 0, duration: 10, text: "segment 1" }],
      fullText: "full text",
    });
  };

  it("should run a 5-video x 2-model matrix and generate report", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
      createTestVideo("v2", 20, "medium"),
      createTestVideo("v3", 30, "high"),
      createTestVideo("v4", 40, "low"),
      createTestVideo("v5", 50, "medium"),
    ];

    const models = [
      getModel("gpt-4o-mini")!,
      getModel("gemini-2.5-flash")!,
    ];

    // Mock existsSync and readFileSync for transcripts
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    const mockJudgeClient = {
      generate: vi.fn().mockResolvedValue({
        ok: true,
        value: JSON.stringify({
          completeness: 8,
          accuracy: 9,
          topicCoverage: 7,
          atomicity: 10,
          overallScore: 8.5,
          reasoning: "Mock reasoning that is long enough",
          missingClaims: [],
          hallucinations: [],
          redundancies: [],
          gapAreas: []
        }),
        usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
      })
    };

    const options = {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini"],
      maxConcurrency: 2,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: () => mockJudgeClient as unknown as LlmClient,
    };

    const result = await runEvaluationMatrix(corpus, models, options);

    expect(result.cells.length).toBe(10); // 5 videos x 2 models x 1 variant
    for (const cell of result.cells) {
      expect(cell.scores).toBeDefined();
      expect(cell.scores!.length).toBeGreaterThan(0);
      expect(cell.scores![0].overallScore).toBeGreaterThanOrEqual(0);
      expect(cell.usage?.availability).toBe("partial-actual");
      expect(cell.usage?.judge?.actual?.totalTokens).toBe(160);
    }

    const report = aggregateMatrixResults(result.cells);
    expect(report.modelStats[models[0].id]).toBeDefined();
    expect(report.videoStats["v1"]).toBeDefined();
    expect(report.variantCostSummary).toBeDefined();
    expect(report.variantCostSummary!["raw"]).toBeDefined();
    expect(report.actualUsageSummary?.cellsWithActualUsage).toBe(10);
    expect(report.actualUsageSummary?.totalTokens).toBe(1600);

    const md = renderMatrixReport(report);
    expect(md).toContain("Video Heatmap");
    expect(md).toContain(models[0].id);
    expect(md).toContain("Variant Cost Breakdown");
    expect(md).toContain("Actual Usage Captured");
    expect(md).toContain("raw");
    expect(md).toContain(`| 1 | ${models[1].id} | 8.50 |`);
    expect(md).toContain("### v1");
    expect(md).toContain("| completeness | 8.00 | 8.00 | 8.00 | 8.00 | 0.00 |");
  });

  it("should estimate cost in dry-run mode without scoring", async () => {
    const corpus = [
      {
        videoId: "v1", url: "http://v1", title: "Video 1", channelName: "Channel 1",
        durationMinutes: 10, topicDomain: "Test", expectedClaimDensity: "low" as const, rationale: "test"
      }
    ];

    const models = [getModel("gpt-4o-mini")!];

    // Mock readFileAsync to return a valid transcript for dry-run test
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );
    const logger = new BufferedLogger();

    const options = {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: true,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini"],
      maxConcurrency: 1,
      timeoutMs: 1000,
      logger,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: () => ({}) as unknown as LlmClient,
    };

    const result = await runEvaluationMatrix(corpus, models, options);

    expect(result.cells.length).toBe(1);
    expect(result.cells[0].costEstimate).toBeDefined();
    expect(result.cells[0].costEstimate!.totalUsd).toBeGreaterThan(0);
    expect(result.cells[0].usage?.availability).toBe("estimated-only");
    expect(result.cells[0].usage?.extraction?.estimated.totalTokens).toBeGreaterThan(0);
    // In dry run, it shouldn't actually call the judge so scores is empty array
    expect(result.cells[0].scores).toEqual([]);
    expect(logger.entries.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[cell 1/1] videoId=v1 modelId=gpt-4o-mini variant=raw"),
        expect.stringContaining("[dry-run] Would extract claims for v1 using gpt-4o-mini"),
        expect.stringContaining("[dry-run] Would score claims for v1 using gpt-4o-mini"),
        expect.stringContaining("[cell 1/1] done in"),
      ])
    );
  });

  it("should average scores from multiple judges", () => {
    const createMockScore = (score: number) => ({
      completeness: score,
      accuracy: score,
      topicCoverage: score,
      atomicity: score,
      overallScore: score,
      reasoning: "Mock reasoning long enough",
      missingClaims: [],
      hallucinations: [],
      redundancies: [],
      gapAreas: []
    });

    const cells = [
      {
        videoId: "v1",
        modelId: "m1",
        extractorVariantId: "raw" as const,
        claimSet: [],
        scores: [createMockScore(10), createMockScore(0)]
      }
    ];

    const report = aggregateMatrixResults(cells);
    expect(report.modelStats["m1"].dimensions.overallScore.mean).toBe(5);
    expect(report.modelStats["m1"].dimensions.completeness.mean).toBe(5);
  });

  it("should report zero judge cost when scores are resumed from cache", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
    ];
    const models = [getModel("gpt-4o-mini")!];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    vi.mocked(matrixCache.getCachedScore).mockResolvedValue([
      {
        completeness: 8,
        accuracy: 9,
        topicCoverage: 7,
        atomicity: 10,
        overallScore: 8.5,
        reasoning: "Mock reasoning that is long enough",
        missingClaims: [],
        hallucinations: [],
        redundancies: [],
        gapAreas: []
      }
    ]);

    const options = {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: true,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini"],
      maxConcurrency: 1,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: () => ({}) as unknown as LlmClient,
    };

    const result = await runEvaluationMatrix(corpus, models, options);

    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.scores).toHaveLength(1);
    expect(result.cells[0]?.costEstimate?.judgeUsd).toBe(0);
  });

  it("should bound judge fan-out by maxConcurrency while preserving partial success", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
    ];
    const models = [getModel("gpt-4o-mini")!];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    let activeJudgeCalls = 0;
    let maxActiveJudgeCalls = 0;
    const judgeClientFactory = (judgeModelId: string) => ({
      generate: vi.fn().mockImplementation(async () => {
        activeJudgeCalls++;
        maxActiveJudgeCalls = Math.max(maxActiveJudgeCalls, activeJudgeCalls);
        await new Promise((resolve) => setTimeout(resolve, judgeModelId === "gpt-4o-mini" ? 25 : 5));
        activeJudgeCalls--;
        if (judgeModelId === "gemini-2.5-flash") {
          throw new Error("judge unavailable");
        }
        return {
          ok: true,
          value: JSON.stringify({
            completeness: 8,
            accuracy: 8,
            topicCoverage: 8,
            atomicity: 8,
            overallScore: 8,
            reasoning: "Mock reasoning long enough",
            missingClaims: [],
            hallucinations: [],
            redundancies: [],
            gapAreas: []
          })
        };
      })
    });

    const result = await runEvaluationMatrix(corpus, models, {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini", "gemini-2.5-flash"],
      maxConcurrency: 1,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: judgeClientFactory as unknown as (modelId: string) => LlmClient,
    });

    expect(maxActiveJudgeCalls).toBe(1);
    expect(result.metadata.failedCellCount).toBe(0);
    expect(result.metadata.partialFailureCount).toBe(1);
    expect(result.cells[0]?.scores).toHaveLength(1);
    expect(result.cells[0]?.warnings).toContainEqual(
      expect.stringContaining("gemini-2.5-flash")
    );
    expect(result.cells[0]?.warnings).toContainEqual(
      expect.stringContaining("judge unavailable")
    );
    expect(result.cells[0]?.usage?.judge?.estimatedCostUsd).toBeCloseTo(result.cells[0]?.costEstimate?.judgeUsd ?? 0, 10);
  });

  it("should retain judge usage projections when every judge call fails", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
    ];
    const models = [getModel("gpt-4o-mini")!];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    const failingJudgeClientFactory = () => ({
      generate: vi.fn().mockRejectedValue(new Error("judge unavailable")),
    });

    const result = await runEvaluationMatrix(corpus, models, {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini", "gemini-2.5-flash"],
      maxConcurrency: 1,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: failingJudgeClientFactory as unknown as (modelId: string) => LlmClient,
    });

    expect(result.metadata.failedCellCount).toBe(1);
    expect(result.metadata.partialFailureCount).toBe(0);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.scores).toHaveLength(0);
    expect(result.cells[0]?.usage?.judge).toBeDefined();
    expect(result.cells[0]?.usage?.judge?.estimatedCostUsd).toBeCloseTo(result.cells[0]?.costEstimate?.judgeUsd ?? 0, 10);
    expect(result.cells[0]?.usage?.availability).toBe("estimated-only");
  });

  it("should not count semaphore queue time toward judge timeouts", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
    ];
    const models = [getModel("gpt-4o-mini")!];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    let activeJudgeCalls = 0;
    let maxActiveJudgeCalls = 0;
    const judgeClientFactory = () => ({
      generate: vi.fn().mockImplementation(async () => {
        activeJudgeCalls++;
        maxActiveJudgeCalls = Math.max(maxActiveJudgeCalls, activeJudgeCalls);
        try {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            ok: true,
            value: JSON.stringify({
              completeness: 8,
              accuracy: 8,
              topicCoverage: 8,
              atomicity: 8,
              overallScore: 8,
              reasoning: "Mock reasoning long enough",
              missingClaims: [],
              hallucinations: [],
              redundancies: [],
              gapAreas: []
            })
          };
        } finally {
          activeJudgeCalls--;
        }
      })
    });

    const result = await runEvaluationMatrix(corpus, models, {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
      maxConcurrency: 1,
      timeoutMs: 50,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: judgeClientFactory as unknown as (modelId: string) => LlmClient,
    });

    expect(maxActiveJudgeCalls).toBe(1);
    expect(result.metadata.failedCellCount).toBe(0);
    expect(result.metadata.partialFailureCount).toBe(0);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.scores).toHaveLength(3);
  });

  it("should not count semaphore queue time toward extraction timeouts", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
      createTestVideo("v2", 12, "low"),
      createTestVideo("v3", 14, "low"),
    ];
    const models = [getModel("gpt-4o-mini")!];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    mockExtractionDelaysByVideoId.set("v1", 30);
    mockExtractionDelaysByVideoId.set("v2", 30);
    mockExtractionDelaysByVideoId.set("v3", 30);

    const result = await runEvaluationMatrix(corpus, models, {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini"],
      maxConcurrency: 1,
      timeoutMs: 50,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: () => ({
        generate: vi.fn().mockResolvedValue({
          ok: true,
          value: JSON.stringify({
            completeness: 8,
            accuracy: 8,
            topicCoverage: 8,
            atomicity: 8,
            overallScore: 8,
            reasoning: "Mock reasoning long enough",
            missingClaims: [],
            hallucinations: [],
            redundancies: [],
            gapAreas: []
          })
        })
      }) as unknown as LlmClient,
    });

    expect(result.metadata.failedCellCount).toBe(0);
    expect(result.metadata.partialFailureCount).toBe(0);
    expect(result.cells).toHaveLength(3);
    for (const cell of result.cells) {
      expect(cell.scores).toHaveLength(1);
      expect(cell.error).toBeUndefined();
    }
  });

  it("should keep extraction and judge calls within the shared maxConcurrency budget", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
      createTestVideo("v2", 12, "low"),
    ];
    const models = [getModel("gpt-4o-mini")!];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => string);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as Promise<string>
    );

    mockExtractionDelaysByVideoId.set("v1", 5);
    mockExtractionDelaysByVideoId.set("v2", 60);

    const judgeClientFactory = (judgeModelId: string) => ({
      generate: vi.fn().mockImplementation(async () =>
        trackActiveProviderCall(async () => {
          await new Promise((resolve) => setTimeout(resolve, judgeModelId === "gpt-4o-mini" ? 35 : 20));
          return {
            ok: true,
            value: JSON.stringify({
              completeness: 8,
              accuracy: 8,
              topicCoverage: 8,
              atomicity: 8,
              overallScore: 8,
              reasoning: "Mock reasoning long enough",
              missingClaims: [],
              hallucinations: [],
              redundancies: [],
              gapAreas: []
            })
          };
        })
      )
    });

    const result = await runEvaluationMatrix(corpus, models, {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o-mini", "gemini-2.5-flash"],
      maxConcurrency: 2,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: judgeClientFactory as unknown as (modelId: string) => LlmClient,
    });

    expect(result.cells).toHaveLength(2);
    expect(result.cells.every((cell) => cell.scores?.length === 2)).toBe(true);
    expect(maxActiveProviderCalls).toBeLessThanOrEqual(2);
  });
});
