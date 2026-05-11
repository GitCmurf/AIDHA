import type { MatrixCell } from "./matrix-runner.js";
import type { Logger } from "../utils/logger.js";
import { buildTeacherAwareHints } from "./teacher-analysis.js";
import { createNarrowVideoReportBuilder } from "./narrow-video-report-builder.js";
import { createNarrowJudgeStage } from "./narrow-judge-stage.js";
import { createNarrowRefineStage } from "./narrow-refine-stage.js";
import { createNarrowScoreStage } from "./narrow-score-stage.js";
import { createNarrowShortlistStage } from "./narrow-shortlist-stage.js";
import type { NarrowComparisonVideoReport } from "./narrow-report-types.js";
import type { RunNarrowManualBaselineOptions } from "./narrow-run-options.js";
import type { NarrowBaselineRunContext } from "./narrow-run-context.js";
import type { NarrowShortlistTarget } from "./stage-artifact-store.js";

export interface NarrowStagePipelineResult {
  videos: NarrowComparisonVideoReport[];
  fallbackTriggeredFor: string[];
  refinedTargets: NarrowShortlistTarget[];
  escalatedVideos: string[];
  escalationReasonsByVideo: Record<string, string[]>;
}

export async function runNarrowBaselineStagePipeline(
  options: RunNarrowManualBaselineOptions,
  context: NarrowBaselineRunContext,
  logger: Logger
): Promise<NarrowStagePipelineResult> {
  const buildVideoReports = (input: {
    harnessCells: MatrixCell[];
    fallbackCells: MatrixCell[];
    fallbackTriggeredFor: string[];
  }) => createNarrowVideoReportBuilder({
    corpus: options.corpus,
    transcriptByVideo: context.transcriptByVideo,
    goldByVideo: context.goldByVideo,
    manualByVideo: context.manualByVideo,
    fallbackCells: input.fallbackCells,
    fallbackTriggeredFor: input.fallbackTriggeredFor,
    embeddingClient: context.embeddingClient,
    budgetState: context.budgetState,
    budgetSkips: context.budgetSkips,
    logger,
  }).buildVideoReports({
    harnessCells: input.harnessCells,
    includeManualBaselines: context.includeManualBaselines,
  });
  const shortlistStage = createNarrowShortlistStage({
    corpus: options.corpus,
    models: options.models,
    stage1Variants: context.stage1Variants,
    runMode: context.runMode,
    outputDir: options.outputDir,
    transcriptDir: options.transcriptDir,
    fallbackModelId: options.fallbackModelId,
    chunkModes: context.chunkModes,
    promptConfigs: context.promptConfigs,
    shortlistPerVideo: context.shortlistPerVideo,
    adaptiveEscalation: context.adaptiveEscalation,
    enablePromptRouting: context.enablePromptRouting,
    inputSignature: context.extractionStageInputSignature,
    clientFactory: options.clientFactory,
    maxConcurrency: options.maxConcurrency ?? 1,
    timeoutMs: options.timeoutMs ?? 120_000,
    buildVideoReports,
    includeManualBaselines: context.includeManualBaselines,
    logger,
  });
  const shortlistStageResult = await shortlistStage.run();
  context.stageExecution.shortlist = shortlistStageResult.execution;
  const {
    initialHarnessCells,
    fallbackTriggeredFor,
    fallbackCells,
    initialVideos,
    shortlistTargets,
    escalatedVideos,
    escalationReasonsByVideo,
  } = shortlistStageResult;

  const judgeClients = new Map(
    context.judgeEnabled
      ? options.judgeModelIds.map((judgeModelId) => [judgeModelId, options.clientFactory(judgeModelId)])
      : []
  );
  const videoReportBuilder = createNarrowVideoReportBuilder({
    corpus: options.corpus,
    transcriptByVideo: context.transcriptByVideo,
    goldByVideo: context.goldByVideo,
    manualByVideo: context.manualByVideo,
    fallbackCells,
    fallbackTriggeredFor,
    embeddingClient: context.embeddingClient,
    budgetState: context.budgetState,
    budgetSkips: context.budgetSkips,
    logger,
  });
  const scoreStage = createNarrowScoreStage({
    corpus: options.corpus,
    runMode: context.runMode,
    outputDir: options.outputDir,
    transcriptByVideo: context.transcriptByVideo,
    goldByVideo: context.goldByVideo,
    manualByVideo: context.manualByVideo,
    fallbackCells,
    fallbackTriggeredFor,
    enableEmbeddings: context.preset.enableEmbeddings,
    embeddingClientAvailable: context.embeddingClientAvailable,
    embeddingModel: context.googleEmbeddingConfig.model,
    embeddingBaseUrl: context.googleEmbeddingConfig.baseUrl,
    embeddingBatchSize: context.googleEmbeddingConfig.batchSize,
    maxEmbeddingRequestsPerRun: options.maxEmbeddingRequestsPerRun,
    taskType: context.googleEmbeddingConfig.taskType,
    outputDimensionality: context.googleEmbeddingConfig.outputDimensionality,
    videoReportBuilder,
    logger,
  });
  const judgeStage = createNarrowJudgeStage({
    outputDir: options.outputDir,
    transcriptByVideo: context.transcriptByVideo,
    goldByVideo: context.goldByVideo,
    manualByVideo: context.manualByVideo,
    fallbackCells,
    fallbackTriggeredFor,
    shortlistPerVideo: context.shortlistPerVideo,
    judgeClients,
    judgeModelIds: options.judgeModelIds,
    judgeMaxTokens: options.judgeMaxTokens ?? 4000,
    logger,
  });
  const refineStage = createNarrowRefineStage({
    corpus: options.corpus,
    models: options.models,
    stage2Variants: context.stage2Variants,
    runMode: context.runMode,
    outputDir: options.outputDir,
    transcriptDir: options.transcriptDir,
    clientFactory: options.clientFactory,
    maxConcurrency: options.maxConcurrency ?? 1,
    timeoutMs: options.timeoutMs ?? 120_000,
    enablePromptRouting: context.enablePromptRouting,
    remainingRefinedSelfImproveCells: () => context.budgetState.remainingRefinedSelfImproveCells,
    budgetSkips: context.budgetSkips,
    logger,
  });

  const teacherAwareHints = context.includeManualBaselines ? buildTeacherAwareHints(initialVideos) : {};
  const refineStageResult = await refineStage.run({
    extractionStageInputSignature: context.extractionStageInputSignature,
    shortlistTargets,
    initialHarnessCells,
    teacherAwareHints,
  });
  context.stageExecution.refine = refineStageResult.execution;
  const refinedSelfImproveCells = refineStageResult.refinedSelfImproveCells;
  const finalHarnessCells = refineStageResult.finalHarnessCells;
  const scoreStageResult = await scoreStage.run({
    stageInputSignature: context.stageInputSignature,
    corpusSignature: context.corpusSignature,
    shortlistTargets,
    refinedSelfImproveCells,
    finalHarnessCells,
    includeManualBaselines: context.includeManualBaselines,
  });
  context.stageExecution.score = scoreStageResult.execution;
  let videos = scoreStageResult.videos;
  if (context.judgeEnabled) {
    const judgeStageResult = await judgeStage.run({
      stageInputSignature: context.stageInputSignature,
      runMode: context.runMode,
      videos,
      harnessCells: finalHarnessCells,
      includeManualBaselines: context.includeManualBaselines,
    });
    context.stageExecution.judge = judgeStageResult.execution;
    videos = judgeStageResult.videos;
  } else {
    logger.info("[stage4-start] judge");
    logger.info("[stage4-done] judge");
    context.budgetSkips.push("judge-disabled-by-mode");
    context.stageExecution.judge = "skipped";
  }

  return {
    videos,
    fallbackTriggeredFor,
    refinedTargets: refineStageResult.refinedTargets,
    escalatedVideos,
    escalationReasonsByVideo,
  };
}
