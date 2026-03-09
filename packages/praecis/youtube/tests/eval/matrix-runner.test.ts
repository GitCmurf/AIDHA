import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { basename } from "node:path";
import { runEvaluationMatrix } from "../../src/eval/matrix-runner";
import { MODEL_REGISTRY } from "../../src/eval/model-registry";
import { aggregateMatrixResults } from "../../src/eval/matrix-aggregator";
import { renderMatrixReport } from "../../src/eval/report-markdown";

vi.mock("node:fs");
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(),
  writeFile: vi.fn().mockResolvedValue(),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
}));
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(),
  writeFile: vi.fn().mockResolvedValue(),
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
    }])
  }))
}));

describe("Matrix Runner Integration", () => {
  it("should run a 5-video x 2-model matrix and generate report", async () => {
    const corpus = [
      {
        videoId: "v1", url: "http://v1", title: "Video 1", channelName: "Channel 1",
        durationMinutes: 10, topicDomain: "Test", expectedClaimDensity: "low" as const, rationale: "test"
      },
      {
        videoId: "v2", url: "http://v2", title: "Video 2", channelName: "Channel 2",
        durationMinutes: 20, topicDomain: "Test", expectedClaimDensity: "medium" as const, rationale: "test"
      },
      {
        videoId: "v3", url: "http://v3", title: "Video 3", channelName: "Channel 3",
        durationMinutes: 30, topicDomain: "Test", expectedClaimDensity: "high" as const, rationale: "test"
      },
      {
        videoId: "v4", url: "http://v4", title: "Video 4", channelName: "Channel 4",
        durationMinutes: 40, topicDomain: "Test", expectedClaimDensity: "low" as const, rationale: "test"
      },
      {
        videoId: "v5", url: "http://v5", title: "Video 5", channelName: "Channel 5",
        durationMinutes: 50, topicDomain: "Test", expectedClaimDensity: "medium" as const, rationale: "test"
      }
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
    vi.mocked(readFileSync).mockImplementation(mockTranscriptImplementation as (path: string | URL | number) => any);
    vi.mocked(readFileAsync).mockImplementation((path: string | Buffer | URL | number) =>
      Promise.resolve(mockTranscriptImplementation(path as string)) as any
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
      maxConcurrency: 1,
      timeoutMs: 1000,
      extractorClientFactory: () => ({}) as any,
      judgeClientFactory: () => mockJudgeClient as any,
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

  it("should average scores from multiple judges", () => {
    const cells: any[] = [
      {
        videoId: "v1",
        modelId: "m1",
        extractorVariantId: "raw",
        scores: [
          { completeness: 10, accuracy: 10, topicCoverage: 10, atomicity: 10, overallScore: 10 },
          { completeness: 0, accuracy: 0, topicCoverage: 0, atomicity: 0, overallScore: 0 }
        ]
      }
    ];

    const report = aggregateMatrixResults(cells);
    expect(report.modelStats["m1"].dimensions.overallScore.mean).toBe(5);
    expect(report.modelStats["m1"].dimensions.completeness.mean).toBe(5);
  });
});
