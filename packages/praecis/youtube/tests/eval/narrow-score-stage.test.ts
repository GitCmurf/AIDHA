import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MatrixCell } from "../../src/eval/matrix-runner.js";
import { createNarrowScoreStage } from "../../src/eval/narrow-score-stage.js";
import { writeNarrowStageArtifact, type NarrowScoreStageArtifact } from "../../src/eval/stage-artifact-store.js";
import type { NarrowComparisonVideoReport } from "../../src/eval/narrow-report-types.js";
import type { Logger } from "../../src/utils/logger.js";

const corpus = [{
  videoId: "video-1",
  url: "https://youtube.com/watch?v=video-1",
  title: "Video 1",
  channelName: "Channel",
  durationMinutes: 1,
  topicDomain: "strategy",
  expectedClaimDensity: "low",
  rationale: "test",
}] as any;

function cell(): MatrixCell {
  return {
    videoId: "video-1",
    modelId: "model-1",
    extractorVariantId: "raw",
    promptConfigId: "baseline",
    chunkMode: "large-request",
    claimSet: [{ text: "Claim text.", type: "fact", source: "llm" }],
  } as MatrixCell;
}

function report(candidateId = "harness/model-1/raw/baseline/large-request"): NarrowComparisonVideoReport {
  const coverage = {
    matched: 1,
    total: 1,
    ratio: 1,
    rootsMatched: 1,
    rootsTotal: 1,
    rootRatio: 1,
    childrenMatched: 0,
    childrenTotal: 0,
    childRatio: 0,
    unmatchedGoldClaims: [],
    unmatchedCandidateClaims: [],
    matchedPairs: [{
      goldId: "gold-1",
      goldText: "Claim text.",
      candidateText: "Claim text.",
      candidateIndex: 0,
      kind: "exact",
      lexicalScore: 1,
      proxySemanticScore: 1,
    }],
    nearestMisses: [],
  };

  return {
    videoId: "video-1",
    title: "Video 1",
    durationMinutes: 1,
    transcriptStructureProfile: {
      tags: [],
      cueMatches: [],
    },
    candidateReports: [{
      candidateId,
      sourceKind: "harness",
      modelId: "model-1",
      variantId: "raw",
      claimCount: 1,
      semanticCoverage: coverage,
      strictCoverage: coverage,
      goldCoverage: coverage,
      diagnostics: {},
    }],
  } as NarrowComparisonVideoReport;
}

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createStage(outputDir: string, buildVideoReport = vi.fn().mockResolvedValue(report())) {
  return {
    buildVideoReport,
    stage: createNarrowScoreStage({
      corpus,
      runMode: "fast-triage",
      outputDir,
      transcriptByVideo: new Map([["video-1", {
        videoId: "video-1",
        fullText: "Claim text.",
        segments: [{ start: 0, duration: 1, text: "Claim text." }],
        structureProfile: { tags: [], cueMatches: [] },
      } as any]]),
      goldByVideo: new Map([["video-1", [{ id: "gold-1", text: "Claim text.", type: "fact" } as any]]]),
      manualByVideo: new Map(),
      fallbackCells: [],
      fallbackTriggeredFor: [],
      enableEmbeddings: false,
      embeddingClientAvailable: false,
      videoReportBuilder: { buildVideoReport } as any,
      logger: logger(),
    }),
  };
}

describe("narrow score stage", () => {
  it("recomputes scores and writes stage and per-video artifacts", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-score-stage-"));
    const { stage, buildVideoReport } = createStage(outputDir);

    const result = await stage.run({
      stageInputSignature: "score-v1",
      corpusSignature: "corpus-v1",
      shortlistTargets: [],
      refinedSelfImproveCells: [],
      finalHarnessCells: [cell()],
      includeManualBaselines: false,
    });

    expect(result.execution).toBe("recomputed");
    expect(result.videos).toHaveLength(1);
    expect(buildVideoReport).toHaveBeenCalledTimes(1);
    await expect(readFile(join(outputDir, "stages", "score.json"), "utf-8")).resolves.toContain("\"inputSignature\": \"score-v1\"");
    await expect(readFile(join(outputDir, "stages", "score-video-video-1.json"), "utf-8")).resolves.toContain("\"stage\": \"score-video\"");
  });

  it("resumes a matching score-stage artifact without rebuilding videos", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-score-stage-resume-"));
    const cachedReport = report("cached-candidate");
    await writeNarrowStageArtifact<NarrowScoreStageArtifact>(outputDir, "score", {
      stage: "score",
      mode: "fast-triage",
      createdAt: "2026-05-11T00:00:00.000Z",
      inputSignature: "score-v1",
      videos: [cachedReport],
    });
    const { stage, buildVideoReport } = createStage(outputDir);

    const result = await stage.run({
      stageInputSignature: "score-v1",
      corpusSignature: "corpus-v1",
      shortlistTargets: [],
      refinedSelfImproveCells: [],
      finalHarnessCells: [cell()],
      includeManualBaselines: false,
    });

    expect(result.execution).toBe("resumed");
    expect(result.videos[0]?.candidateReports[0]?.candidateId).toBe("cached-candidate");
    expect(buildVideoReport).not.toHaveBeenCalled();
  });
});
