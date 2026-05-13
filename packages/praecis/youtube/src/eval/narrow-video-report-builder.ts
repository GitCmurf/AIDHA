import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { Logger } from "../utils/logger.js";
import type { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import type { CoverageCacheKey, EmbeddingBudgetState } from "./coverage-engine.js";
import {
  buildComparableClaimSetIndex,
  buildComparableClaimSetsForVideo,
} from "./narrow-comparable-claim-set.js";
import {
  backfillTranscriptStructureProfile,
  buildCandidateReport,
} from "./narrow-candidate-report.js";
import { annotateOptimizationRanks } from "./narrow-optimization-ranking.js";
import { enrichReportsWithTeacherData } from "./teacher-analysis.js";
import type { TranscriptData } from "./narrow-input-loader.js";
import type {
  ComparableClaimSet,
  GoldCoverageSummary,
  NarrowComparisonCandidateReport,
  NarrowComparisonVideoReport,
} from "./narrow-report-types.js";

export interface NarrowVideoReportBuilderContext {
  corpus: CorpusEntry[];
  transcriptByVideo: Map<string, TranscriptData>;
  goldByVideo: Map<string, FlattenedGoldenClaimNode[]>;
  manualByVideo: Map<string, ComparableClaimSet[]>;
  fallbackCells: MatrixCell[];
  fallbackTriggeredFor: string[];
  embeddingClient?: GeminiEmbeddingClient;
  budgetState: EmbeddingBudgetState;
  budgetSkips: string[];
  logger: Logger;
}

export interface BuildVideoReportsInput {
  harnessCells: MatrixCell[];
  includeManualBaselines: boolean;
  embeddingEligibleCandidateIdsByVideo?: Map<string, Set<string>>;
}

export interface BuildVideoReportInput extends BuildVideoReportsInput {
  video: CorpusEntry;
}

export interface BackfillVideoReportsInput {
  videos: NarrowComparisonVideoReport[];
}

export function createNarrowVideoReportBuilder(context: NarrowVideoReportBuilderContext): {
  buildVideoReport: (input: BuildVideoReportInput) => Promise<NarrowComparisonVideoReport>;
  buildVideoReports: (input: BuildVideoReportsInput) => Promise<NarrowComparisonVideoReport[]>;
  backfillVideoReports: (input: BackfillVideoReportsInput) => NarrowComparisonVideoReport[];
} {
  const buildSingleVideoReport = async (
    video: CorpusEntry,
    comparableClaimSetIndex: ReturnType<typeof buildComparableClaimSetIndex>,
    includeManualBaselinesForVideo: boolean,
    embeddingEligibleCandidateIdsByVideo?: Map<string, Set<string>>
  ): Promise<NarrowComparisonVideoReport> => {
    const coverageStartedAt = Date.now();
    context.logger.info(`[coverage-start] video=${video.videoId}`);
    const transcript = context.transcriptByVideo.get(video.videoId);
    const goldClaims = context.goldByVideo.get(video.videoId);
    if (!transcript || !goldClaims) {
      throw new Error(`Missing transcript or gold baseline for ${video.videoId}`);
    }
    const transcriptProfile = transcript.structureProfile;

    const comparableClaimSets = buildComparableClaimSetsForVideo(
      video.videoId,
      comparableClaimSetIndex,
      context.manualByVideo,
      includeManualBaselinesForVideo
    );
    const coverageCache = new Map<CoverageCacheKey, GoldCoverageSummary>();
    const embeddingEligibleCandidateIds = embeddingEligibleCandidateIdsByVideo?.get(video.videoId);
    let effectiveEmbeddingClient =
      context.embeddingClient && embeddingEligibleCandidateIds && embeddingEligibleCandidateIds.size > 0
        ? context.embeddingClient
        : undefined;
    if (effectiveEmbeddingClient && context.budgetState.remainingEmbeddingRequests <= 0) {
      context.budgetSkips.push(`embedding-budget-exceeded:${video.videoId}:0`);
      effectiveEmbeddingClient = undefined;
      context.logger.warn(`[embedding-skip-budget] video=${video.videoId} required=1 remaining=0`);
    }

    const candidateReports: NarrowComparisonCandidateReport[] = [];
    for (const [candidateIndex, candidate] of comparableClaimSets.entries()) {
      if (effectiveEmbeddingClient && context.budgetState.remainingEmbeddingRequests <= 0) {
        context.budgetSkips.push(`embedding-budget-exceeded:${video.videoId}:${candidate.candidateId}`);
        effectiveEmbeddingClient = undefined;
        context.logger.warn(
          `[embedding-skip-budget] video=${video.videoId} candidate=${candidate.candidateId} remaining=0`
        );
      }

      candidateReports.push(await buildCandidateReport(
        candidate,
        goldClaims,
        transcriptProfile,
        embeddingEligibleCandidateIds?.has(candidate.candidateId) ? effectiveEmbeddingClient : undefined,
        coverageCache,
        context.budgetState
      ));

      context.logger.info(
        `[coverage-candidate] video=${video.videoId} index=${candidateIndex + 1}/${comparableClaimSets.length} candidate=${candidate.candidateId}`
      );
    }

    if (includeManualBaselinesForVideo) {
      if (effectiveEmbeddingClient && context.budgetState.remainingEmbeddingRequests <= 0) {
        context.budgetSkips.push(`embedding-budget-exceeded:${video.videoId}:teacher`);
        effectiveEmbeddingClient = undefined;
        context.logger.warn(`[embedding-skip-budget] video=${video.videoId} phase=teacher remaining=0`);
      }

      await enrichReportsWithTeacherData(
        candidateReports,
        comparableClaimSets,
        effectiveEmbeddingClient,
        coverageCache,
        embeddingEligibleCandidateIds,
        context.budgetState
      );
    }
    context.logger.info(`[coverage-done] video=${video.videoId} durationMs=${Date.now() - coverageStartedAt}`);
    return {
      videoId: video.videoId,
      title: video.title,
      transcriptStructureProfile: {
        tags: [...transcriptProfile.tags],
        cueMatches: [...transcriptProfile.cueMatches],
      },
      candidateReports,
    };
  };

  const buildVideoReport = async (
    input: BuildVideoReportInput
  ): Promise<NarrowComparisonVideoReport> => {
    const comparableClaimSetIndex = buildComparableClaimSetIndex(
      input.harnessCells,
      context.fallbackCells,
      `Fallback for unavailable or degraded model rows: ${context.fallbackTriggeredFor.join(", ")}`
    );
    const result = await buildSingleVideoReport(
      input.video,
      comparableClaimSetIndex,
      input.includeManualBaselines,
      input.embeddingEligibleCandidateIdsByVideo
    );
    annotateOptimizationRanks([result]);
    return result;
  };

  const buildVideoReports = async (
    input: BuildVideoReportsInput
  ): Promise<NarrowComparisonVideoReport[]> => {
    const videos: NarrowComparisonVideoReport[] = [];
    const comparableClaimSetIndex = buildComparableClaimSetIndex(
      input.harnessCells,
      context.fallbackCells,
      `Fallback for unavailable or degraded model rows: ${context.fallbackTriggeredFor.join(", ")}`
    );

    for (const video of context.corpus) {
      videos.push(await buildSingleVideoReport(
        video,
        comparableClaimSetIndex,
        input.includeManualBaselines,
        input.embeddingEligibleCandidateIdsByVideo
      ));
    }

    annotateOptimizationRanks(videos);

    return videos;
  };

  const backfillVideoReports = (
    input: BackfillVideoReportsInput
  ): NarrowComparisonVideoReport[] =>
    input.videos.map((video) => backfillTranscriptStructureProfile(video, context.transcriptByVideo));

  return { buildVideoReport, buildVideoReports, backfillVideoReports };
}
