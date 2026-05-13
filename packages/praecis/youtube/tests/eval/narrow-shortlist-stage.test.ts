import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MatrixCell } from "../../src/eval/matrix-runner.js";
import type { NarrowComparisonVideoReport } from "../../src/eval/narrow-report-types.js";
import { getModel } from "../../src/eval/model-registry.js";
import { createNarrowShortlistStage } from "../../src/eval/narrow-shortlist-stage.js";
import {
  writeNarrowStageArtifact,
  type NarrowShortlistStageArtifact,
} from "../../src/eval/stage-artifact-store.js";
import type { Logger } from "../../src/utils/logger.js";

function coverage(ratio: number) {
  return {
    matched: ratio === 0 ? 0 : 1,
    total: 1,
    ratio,
    rootsMatched: ratio === 0 ? 0 : 1,
    rootsTotal: 1,
    rootRatio: ratio,
    childrenMatched: 0,
    childrenTotal: 0,
    childRatio: 0,
    unmatchedGoldClaims: ratio === 0 ? [{ id: "gold-1", text: "Claim text.", depth: 0 }] : [],
    unmatchedCandidateClaims: [],
    matchedPairs: ratio === 0
      ? []
      : [{
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

function videoReport(candidateId = "harness/model-1/raw/baseline/large-request"): NarrowComparisonVideoReport {
  const candidateCoverage = coverage(1);
  return {
    videoId: "video-1",
    title: "Video 1",
    transcriptStructureProfile: { tags: [], cueMatches: [] },
    candidateReports: [{
      candidateId,
      sourceKind: "harness",
      modelId: "model-1",
      variantId: "raw",
      promptConfigId: "baseline",
      chunkMode: "large-request",
      claimCount: 1,
      structuralTargetScore: 1,
      structuralTargetAssessment: {
        score: 1,
        hasRootCardinalityClaim: true,
        hasMemberListClaim: false,
        hasAvoidRuleClaim: false,
        passesShortlistGate: true,
      },
      strictCoverage: candidateCoverage,
      semanticCoverage: candidateCoverage,
      goldCoverage: candidateCoverage,
      diagnostics: {},
    }],
  } as NarrowComparisonVideoReport;
}

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

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createStage(outputDir: string, buildVideoReports = vi.fn().mockResolvedValue([videoReport()])) {
  return {
    buildVideoReports,
    stage: createNarrowShortlistStage({
      corpus: [],
      models: [getModel("gemini-3.1-flash-lite-preview")!],
      stage1Variants: ["raw"],
      runMode: "fast-triage",
      outputDir,
      transcriptDir: "transcripts",
      fallbackModelId: "fallback-model",
      chunkModes: ["large-request"],
      promptConfigs: ["baseline"],
      shortlistPerVideo: 1,
      adaptiveEscalation: false,
      enablePromptRouting: false,
      inputSignature: "shortlist-v1",
      clientFactory: () => {
        throw new Error("client should not be used");
      },
      maxConcurrency: 1,
      timeoutMs: 1000,
      buildVideoReports,
      includeManualBaselines: false,
      logger: logger(),
    }),
  };
}

describe("narrow shortlist stage", () => {
  it("recomputes shortlist targets and writes stage artifacts", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-shortlist-stage-"));
    const { stage, buildVideoReports } = createStage(outputDir);

    const result = await stage.run();

    expect(result.execution).toBe("recomputed");
    expect(buildVideoReports).toHaveBeenCalledWith({
      harnessCells: [],
      fallbackCells: [],
      fallbackTriggeredFor: [],
    });
    expect(result.shortlistTargets).toEqual([{
      videoId: "video-1",
      modelId: "model-1",
      promptConfigId: "baseline",
      chunkMode: "large-request",
      candidateId: "harness/model-1/raw/baseline/large-request",
      promptPackId: undefined,
    }]);
    await expect(readFile(join(outputDir, "stages", "shortlist.json"), "utf-8")).resolves.toContain("\"inputSignature\": \"shortlist-v1\"");
  });

  it("resumes matching shortlist artifacts without rebuilding videos", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-shortlist-stage-resume-"));
    await writeNarrowStageArtifact<NarrowShortlistStageArtifact>(outputDir, "shortlist", {
      stage: "shortlist",
      mode: "fast-triage",
      createdAt: "2026-05-11T00:00:00.000Z",
      inputSignature: "shortlist-v1",
      chunkModes: ["large-request"],
      promptConfigs: ["baseline"],
      stage1Variants: ["raw"],
      initialHarnessCells: [cell()],
      fallbackTriggeredFor: ["model-2"],
      fallbackCells: [cell()],
      videos: [videoReport("cached-candidate")],
      shortlistTargets: [{
        videoId: "video-1",
        modelId: "model-1",
        promptConfigId: "baseline",
        chunkMode: "large-request",
        candidateId: "cached-candidate",
      }],
      escalatedVideos: ["video-1"],
      escalationReasonsByVideo: { "video-1": ["missing-root-claim"] },
    });
    const { stage, buildVideoReports } = createStage(outputDir);

    const result = await stage.run();

    expect(result.execution).toBe("resumed");
    expect(result.initialHarnessCells).toHaveLength(1);
    expect(result.shortlistTargets[0]?.candidateId).toBe("cached-candidate");
    expect(result.escalatedVideos).toEqual(["video-1"]);
    expect(result.escalationReasonsByVideo).toEqual({ "video-1": ["missing-root-claim"] });
    expect(buildVideoReports).not.toHaveBeenCalled();
  });
});
