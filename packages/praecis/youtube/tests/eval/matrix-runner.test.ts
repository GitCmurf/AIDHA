import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { basename } from "node:path";
import { runEvaluationMatrix } from "../../src/eval/matrix-runner";
import { MODEL_REGISTRY } from "../../src/eval/model-registry";
import { aggregateMatrixResults } from "../../src/eval/matrix-aggregator";
import { renderMatrixReport } from "../../src/eval/report-markdown";
import type { LlmClient } from "../../src/extract/llm-client";

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

vi.mock("../../src/extract/llm-claims", () => ({
  LlmClaimExtractor: vi.fn().mockImplementation(() => ({
    extractClaims: vi.fn().mockResolvedValue([{
      text: "Mock claim",
      excerptIds: ["excerpt-1"],
      startSeconds: 0,
      type: "Fact",
      classification: "Fact",
      domain: "Test",
      confidence: 1,
      why: "reason"
    }]),
    getLastTraces: vi.fn().mockReturnValue([{ prompt: { system: "s", user: "u" }, response: "r" }])
  }))
}));

describe("Matrix Runner Integration", () => {
afterEach(() => {
  vi.resetAllMocks();
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

  it("should run a 5-video x 2-model matrix and generate report", async () => {
    const corpus = [
      createTestVideo("v1", 10, "low"),
      createTestVideo("v2", 20, "medium"),
      createTestVideo("v3", 30, "high"),
      createTestVideo("v4", 40, "low"),
      createTestVideo("v5", 50, "medium"),
    ];

    const models = MODEL_REGISTRY.slice(0, 2);

    // Mock existsSync and readFileSync for transcripts
    vi.mocked(existsSync).mockReturnValue(true);
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
        })
      })
    };

    const options = {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: false,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o"],
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
    }

    const report = aggregateMatrixResults(result.cells);
    expect(report.modelStats[models[0].id]).toBeDefined();
    expect(report.videoStats["v1"]).toBeDefined();

    const md = renderMatrixReport(report);
    expect(md).toContain("Video Heatmap");
    expect(md).toContain(models[0].id);
    expect(md).toContain(`| 1 | ${models[0].id} | 8.50 |`);
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

    const models = MODEL_REGISTRY.slice(0, 1);

    const options = {
      outputDir: "out/test",
      cacheDir: "out/test/cache",
      transcriptDir: "out/test/transcripts",
      resume: false,
      dryRun: true,
      variants: ["raw" as const],
      judgeModels: ["gpt-4o"],
      maxConcurrency: 1,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as unknown as LlmClient,
      judgeClientFactory: () => ({}) as unknown as LlmClient,
    };

    const result = await runEvaluationMatrix(corpus, models, options);

    expect(result.cells.length).toBe(1);
    expect(result.cells[0].costEstimate).toBeDefined();
    expect(result.cells[0].costEstimate!.totalUsd).toBeGreaterThan(0);
    // In dry run, it shouldn't actually call the judge so scores will be empty (or undefined since extraction didn't really run)
    expect(result.cells[0].scores).toEqual([]);
  });

  it("should average scores from multiple judges", () => {
    const createMockScore = (score: number) => ({
      completeness: score,
      accuracy: score,
      topicCoverage: score,
      atomicity: score,
      overallScore: score,
      reasoning: "r",
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
        scores: [createMockScore(10), createMockScore(0)]
      }
    ];

    const report = aggregateMatrixResults(cells);
    expect(report.modelStats["m1"].dimensions.overallScore.mean).toBe(5);
    expect(report.modelStats["m1"].dimensions.completeness.mean).toBe(5);
  });
});
