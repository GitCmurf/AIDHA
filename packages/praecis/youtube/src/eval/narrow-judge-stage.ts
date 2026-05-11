import type { LlmClient } from "../extract/index.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { Logger } from "../utils/logger.js";
import type { CoverageCacheKey } from "./coverage-engine.js";
import {
  buildComparableClaimSetIndex,
  buildComparableClaimSetsForVideo,
} from "./narrow-comparable-claim-set.js";
import { enrichCandidateReportWithJudges } from "./narrow-judge-enrichment.js";
import { selectTeacherComparableCandidate } from "./teacher-analysis.js";
import type { TranscriptData } from "./narrow-input-loader.js";
import type {
  ComparableClaimSet,
  GoldCoverageSummary,
  NarrowComparisonVideoReport,
} from "./narrow-report-types.js";

export interface JudgeNarrowVideoReportsInput {
  videos: NarrowComparisonVideoReport[];
  harnessCells: MatrixCell[];
  includeManualBaselines: boolean;
}

export interface NarrowJudgeStageContext {
  transcriptByVideo: Map<string, TranscriptData>;
  goldByVideo: Map<string, FlattenedGoldenClaimNode[]>;
  manualByVideo: Map<string, ComparableClaimSet[]>;
  fallbackCells: MatrixCell[];
  fallbackTriggeredFor: string[];
  shortlistPerVideo: number;
  judgeClients: Map<string, LlmClient>;
  judgeModelIds: string[];
  judgeMaxTokens: number;
  logger: Logger;
}

export function createNarrowJudgeStage(context: NarrowJudgeStageContext): {
  judgeVideoReports: (input: JudgeNarrowVideoReportsInput) => Promise<void>;
} {
  const judgeVideoReports = async (input: JudgeNarrowVideoReportsInput): Promise<void> => {
    context.logger.info("[stage4-start] judge");
    const comparableClaimSetIndex = buildComparableClaimSetIndex(
      input.harnessCells,
      context.fallbackCells,
      `Fallback for unavailable or degraded model rows: ${context.fallbackTriggeredFor.join(", ")}`
    );
    for (const video of input.videos) {
      const transcript = context.transcriptByVideo.get(video.videoId);
      const goldClaims = context.goldByVideo.get(video.videoId);
      if (!transcript || !goldClaims) {
        throw new Error(`Missing transcript or gold baseline for ${video.videoId}`);
      }
      const comparableClaimSets = buildComparableClaimSetsForVideo(
        video.videoId,
        comparableClaimSetIndex,
        context.manualByVideo,
        input.includeManualBaselines
      );
      const candidateById = new Map(comparableClaimSets.map((candidate) => [candidate.candidateId, candidate]));
      const teacherComparable = await selectTeacherComparableCandidate(
        comparableClaimSets.filter((candidate) => candidate.sourceKind === "manual-baseline"),
        goldClaims,
        undefined,
        new Map<CoverageCacheKey, GoldCoverageSummary>()
      );
      const teacherClaims = teacherComparable?.claims ?? [];
      const preferredRefinedHarness = video.candidateReports
        .filter((candidate) =>
          candidate.sourceKind === "harness"
          && candidate.variantId === "self-improve-v1"
          && (candidate.rankWithinVideo ?? Number.MAX_SAFE_INTEGER) <= context.shortlistPerVideo
        )
        .map((candidate) => candidate.candidateId);
      const topHarnessByRank = video.candidateReports
        .filter((candidate) =>
          (candidate.sourceKind === "harness" || candidate.sourceKind === "fallback-harness")
          && (candidate.rankWithinVideo ?? Number.MAX_SAFE_INTEGER) <= context.shortlistPerVideo
        )
        .map((candidate) => candidate.candidateId);
      const judgeableCandidates = new Set([
        ...video.candidateReports
          .filter((candidate) => candidate.sourceKind === "manual-baseline")
          .map((candidate) => candidate.candidateId),
        ...preferredRefinedHarness,
        ...topHarnessByRank,
      ]);

      for (const report of video.candidateReports) {
        const candidate = candidateById.get(report.candidateId);
        if (!candidate) continue;
        if (!judgeableCandidates.has(report.candidateId)) {
          report.note = [report.note, "Judge skipped for lower-ranked row"].filter(Boolean).join(" - ") || undefined;
          continue;
        }
        await enrichCandidateReportWithJudges(
          report,
          candidate,
          transcript,
          goldClaims,
          teacherClaims,
          context.judgeClients,
          context.judgeModelIds,
          context.judgeMaxTokens,
          context.logger
        );
      }
    }
    context.logger.info("[stage4-done] judge");
  };

  return { judgeVideoReports };
}
