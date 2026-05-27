import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MatrixCell } from "../../src/eval/matrix-runner.js";
import { createNarrowJudgeStage } from "../../src/eval/narrow-judge-stage.js";
import type { NarrowComparisonVideoReport } from "../../src/eval/narrow-report-types.js";
import {
  writeNarrowStageArtifact,
  type NarrowJudgeStageArtifact,
} from "../../src/eval/stage-artifact-store.js";
import type { Logger } from "../../src/utils/logger.js";

function coverage() {
  return {
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
}

function candidateReport(modelId: string, rankWithinVideo: number) {
  const candidateCoverage = coverage();
  return {
    candidateId: `harness/${modelId}/raw/baseline/large-request`,
    sourceKind: "harness",
    modelId,
    variantId: "raw",
    promptConfigId: "baseline",
    chunkMode: "large-request",
    claimCount: 1,
    rankWithinVideo,
    strictCoverage: candidateCoverage,
    semanticCoverage: candidateCoverage,
    goldCoverage: candidateCoverage,
    diagnostics: {},
  };
}

function videoReport(): NarrowComparisonVideoReport {
  return {
    videoId: "video-1",
    title: "Video 1",
    transcriptStructureProfile: { tags: [], cueMatches: [] },
    candidateReports: [
      candidateReport("model-1", 1),
      candidateReport("model-2", 2),
    ],
  } as NarrowComparisonVideoReport;
}

function cell(modelId: string): MatrixCell {
  return {
    videoId: "video-1",
    modelId,
    extractorVariantId: "raw",
    promptConfigId: "baseline",
    chunkMode: "large-request",
    claimSet: [{ text: "Claim text.", type: "fact", source: "llm" }],
  } as MatrixCell;
}

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createStage(outputDir: string) {
  return createNarrowJudgeStage({
    outputDir,
    transcriptByVideo: new Map([["video-1", {
      videoId: "video-1",
      fullText: "Claim text.",
      segments: [{ start: 0, duration: 1, text: "Claim text." }],
      structureProfile: { tags: ["framework"], cueMatches: ["framework"] },
    }]]),
    goldByVideo: new Map([["video-1", [{
      id: "gold-1",
      text: "Claim text.",
      depth: 0,
      path: ["gold-1"],
    } as any]]]),
    manualByVideo: new Map(),
    fallbackCells: [],
    fallbackTriggeredFor: [],
    shortlistPerVideo: 1,
    judgeClients: new Map(),
    judgeModelIds: [],
    judgeMaxTokens: 1000,
    logger: logger(),
  });
}

describe("narrow judge stage", () => {
  it("recomputes judge artifacts and marks lower-ranked harness rows as skipped", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-judge-stage-"));
    const videos = [videoReport()];

    const result = await createStage(outputDir).run({
      stageInputSignature: "judge-v1",
      runMode: "fast-triage",
      videos,
      harnessCells: [cell("model-2")],
      includeManualBaselines: false,
    });

    expect(result.execution).toBe("recomputed");
    expect(result.videos[0]?.candidateReports[1]?.note).toBe("Judge skipped for lower-ranked row");
    await expect(readFile(join(outputDir, "stages", "judge.json"), "utf-8")).resolves.toContain("\"inputSignature\": \"judge-v1\"");
  });

  it("marks judgeable candidates with error when claim set is missing", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-judge-stage-missing-"));
    const videos = [videoReport()];
    // shortlistPerVideo is 1, so model-1 is judgeable.
    // But we only provide model-2 cell.
    const result = await createStage(outputDir).run({
      stageInputSignature: "judge-v1",
      runMode: "fast-triage",
      videos,
      harnessCells: [cell("model-2")],
      includeManualBaselines: false,
    });

    expect(result.videos[0]?.candidateReports[0]?.error).toContain("Judgeable candidate data not found");
  });

  it("resumes matching judge artifacts and backfills transcript structure", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-judge-stage-resume-"));
    const cachedVideo = {
      ...videoReport(),
      transcriptStructureProfile: undefined,
    } as unknown as NarrowComparisonVideoReport;
    await writeNarrowStageArtifact<NarrowJudgeStageArtifact>(outputDir, "judge", {
      stage: "judge",
      mode: "fast-triage",
      createdAt: "2026-05-11T00:00:00.000Z",
      inputSignature: "judge-v1",
      videos: [cachedVideo],
    });

    const result = await createStage(outputDir).run({
      stageInputSignature: "judge-v1",
      runMode: "fast-triage",
      videos: [videoReport()],
      harnessCells: [cell("model-2")],
      includeManualBaselines: false,
    });

    expect(result.execution).toBe("resumed");
    expect(result.videos[0]?.transcriptStructureProfile).toEqual({
      tags: ["framework"],
      cueMatches: ["framework"],
    });
  });
});
