import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { Logger } from "../utils/logger.js";
import type { CorpusEntry } from "./corpus-schema.js";
import { annotateOptimizationRanks } from "./narrow-optimization-ranking.js";
import {
  buildComparableClaimSetIndex,
  buildComparableClaimSetsForVideo,
} from "./narrow-comparable-claim-set.js";
import { backfillTranscriptStructureProfile } from "./narrow-candidate-report.js";
import { buildEmbeddingEligibleCandidateIdsByVideo } from "./narrow-embedding-eligibility.js";
import { buildVideoScoreInputSignature } from "./narrow-stage-signatures.js";
import { createNarrowVideoReportBuilder } from "./narrow-video-report-builder.js";
import type { TranscriptData } from "./narrow-input-loader.js";
import {
  readNarrowStageArtifact,
  readNarrowVideoScoreArtifact,
  writeNarrowStageArtifact,
  writeNarrowVideoScoreArtifact,
  type NarrowScoreStageArtifact,
  type NarrowShortlistTarget,
} from "./stage-artifact-store.js";
import type {
  ComparableClaimSet,
  NarrowComparisonVideoReport,
  NarrowRunMode,
} from "./narrow-report-types.js";

export interface RunNarrowScoreStageInput {
  stageInputSignature: string;
  corpusSignature: string;
  shortlistTargets: NarrowShortlistTarget[];
  refinedSelfImproveCells: MatrixCell[];
  finalHarnessCells: MatrixCell[];
  includeManualBaselines: boolean;
}

export interface RunNarrowScoreStageResult {
  execution: "resumed" | "recomputed";
  videos: NarrowComparisonVideoReport[];
}

export interface NarrowScoreStageContext {
  corpus: CorpusEntry[];
  runMode: NarrowRunMode;
  outputDir: string;
  transcriptByVideo: Map<string, TranscriptData>;
  goldByVideo: Map<string, FlattenedGoldenClaimNode[]>;
  manualByVideo: Map<string, ComparableClaimSet[]>;
  fallbackCells: MatrixCell[];
  fallbackTriggeredFor: string[];
  enableEmbeddings: boolean;
  embeddingClientAvailable: boolean;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingBatchSize?: number;
  maxEmbeddingRequestsPerRun?: number;
  taskType?: string;
  outputDimensionality?: number;
  videoReportBuilder: ReturnType<typeof createNarrowVideoReportBuilder>;
  logger: Logger;
}

export function createNarrowScoreStage(context: NarrowScoreStageContext): {
  run: (input: RunNarrowScoreStageInput) => Promise<RunNarrowScoreStageResult>;
} {
  const run = async (input: RunNarrowScoreStageInput): Promise<RunNarrowScoreStageResult> => {
    const cachedScore = await readNarrowStageArtifact<NarrowScoreStageArtifact>(context.outputDir, "score");
    if (cachedScore?.inputSignature === input.stageInputSignature) {
      context.logger.info("[resume-from] stage=score");
      return {
        execution: "resumed",
        videos: cachedScore.videos.map((video) =>
          backfillTranscriptStructureProfile(video, context.transcriptByVideo)
        ),
      };
    }

    context.logger.info("[stage3-start] score");
    const embeddingEligibleCandidateIdsByVideo = context.enableEmbeddings
      ? buildEmbeddingEligibleCandidateIdsByVideo({
          shortlistTargets: input.shortlistTargets,
          refinedSelfImproveCells: input.refinedSelfImproveCells,
          manualByVideo: context.manualByVideo,
          includeManualBaselines: input.includeManualBaselines,
        })
      : undefined;
    const scoredVideos: NarrowComparisonVideoReport[] = [];
    const finalComparableClaimSetIndex = buildComparableClaimSetIndex(
      input.finalHarnessCells,
      context.fallbackCells,
      `Fallback for unavailable or degraded model rows: ${context.fallbackTriggeredFor.join(", ")}`
    );
    for (const video of context.corpus) {
      const goldClaims = context.goldByVideo.get(video.videoId);
      if (!goldClaims) {
        throw new Error(`Missing gold baseline for ${video.videoId}`);
      }
      const comparableClaimSets = buildComparableClaimSetsForVideo(
        video.videoId,
        finalComparableClaimSetIndex,
        context.manualByVideo,
        input.includeManualBaselines
      );
      const videoScoreSignature = buildVideoScoreInputSignature({
        corpusSignature: input.corpusSignature,
        runMode: context.runMode,
        videoId: video.videoId,
        includeManualBaselines: input.includeManualBaselines,
        enableEmbeddings: context.enableEmbeddings,
        embeddingClientAvailable: context.embeddingClientAvailable,
        goldClaims,
        comparableClaimSets,
        embeddingModel: context.embeddingModel,
        embeddingBaseUrl: context.embeddingBaseUrl,
        embeddingBatchSize: context.embeddingBatchSize,
        maxEmbeddingRequestsPerRun: context.maxEmbeddingRequestsPerRun,
        taskType: context.taskType,
        outputDimensionality: context.outputDimensionality,
      });
      const cachedVideoScore = await readNarrowVideoScoreArtifact(context.outputDir, video.videoId);
      if (cachedVideoScore?.inputSignature === videoScoreSignature) {
        context.logger.info(`[resume-from] stage=score video=${video.videoId}`);
        scoredVideos.push(backfillTranscriptStructureProfile(cachedVideoScore.video, context.transcriptByVideo));
        continue;
      }
      const scoredVideo = await context.videoReportBuilder.buildVideoReport({
        video,
        harnessCells: input.finalHarnessCells,
        includeManualBaselines: input.includeManualBaselines,
        embeddingEligibleCandidateIdsByVideo,
      });
      await writeNarrowVideoScoreArtifact(context.outputDir, {
        stage: "score-video",
        mode: context.runMode,
        createdAt: new Date().toISOString(),
        videoId: video.videoId,
        inputSignature: videoScoreSignature,
        video: scoredVideo,
      });
      scoredVideos.push(scoredVideo);
    }

    annotateOptimizationRanks(scoredVideos);
    await writeNarrowStageArtifact<NarrowScoreStageArtifact>(context.outputDir, "score", {
      stage: "score",
      mode: context.runMode,
      createdAt: new Date().toISOString(),
      inputSignature: input.stageInputSignature,
      videos: scoredVideos,
    });
    context.logger.info("[stage3-done] score");

    return {
      execution: "recomputed",
      videos: scoredVideos,
    };
  };

  return { run };
}
