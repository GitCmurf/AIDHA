import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ResolvedConfig } from "@aidha/config";
import type { LlmClient } from "../extract/index.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import { CorpusEntrySchema, type CorpusEntry } from "./corpus-schema.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { EvalModel } from "./model-registry.js";
import { requestRateLimiterRegistry } from "./request-rate-limiter.js";
import { consoleLogger, type Logger } from "../utils/logger.js";
import { renderNarrowComparisonMarkdown } from "./narrow-report-renderer.js";
import {
  computeCoverageByMode,
  type EmbeddingBudgetState,
} from "./coverage-engine.js";
import { buildTeacherAwareHints } from "./teacher-analysis.js";
import { computeOptimizationScore } from "./narrow-optimization-ranking.js";
import {
  assessStructuralTargets,
  profileTranscriptStructure,
  type StructuralTargetAssessment,
  type TranscriptStructureProfile,
} from "./narrow-structural-targets.js";
import {
  buildExtractionStageInputSignature,
  buildStageInputSignature,
} from "./narrow-stage-signatures.js";
import { runHarnessExtractionOnly } from "./narrow-harness-extraction.js";
import {
  createGoogleEmbeddingClient,
  DEFAULT_GOOGLE_EMBEDDING_MODEL,
  getGoogleEmbeddingConfig,
} from "./narrow-embedding-config.js";
import type {
  ComparableClaimSet,
  NarrowComparisonReport,
  NarrowRunMode,
  NarrowStageId,
} from "./narrow-report-types.js";
import {
  getNarrowModePreset,
  intersectVariants,
} from "./narrow-mode-selection.js";
import {
  loadTranscript,
  loadVideoBaselines,
  type TranscriptData,
} from "./narrow-input-loader.js";
import { buildCorpusSignature } from "./narrow-corpus-signature.js";
import { createNarrowVideoReportBuilder } from "./narrow-video-report-builder.js";
import { createNarrowJudgeStage } from "./narrow-judge-stage.js";
import { createNarrowRefineStage } from "./narrow-refine-stage.js";
import { createNarrowScoreStage } from "./narrow-score-stage.js";
import { createNarrowShortlistStage } from "./narrow-shortlist-stage.js";
import { buildNarrowReportMetadata } from "./narrow-report-metadata.js";

export { computeOptimizationScore } from "./narrow-optimization-ranking.js";
export {
  assessStructuralTargets,
  profileTranscriptStructure,
  type StructuralTargetAssessment,
  type TranscriptStructureProfile,
} from "./narrow-structural-targets.js";
export {
  buildComparableCandidateId,
  buildHarnessComparableClaimSet,
  needsFallbackForModel,
} from "./narrow-comparable-claim-set.js";
export {
  buildExtractionStageInputSignature,
  buildStageInputSignature,
  buildVideoScoreInputSignature,
} from "./narrow-stage-signatures.js";
export {
  selectFastTriageEscalationPack,
  selectShortlistCandidatesForVideo,
  shouldFastTriageEscalate,
} from "./narrow-mode-selection.js";
export { buildCorpusSignature } from "./narrow-corpus-signature.js";
export type {
  CandidateDiagnostics,
  ComparableClaimSet,
  ComparableSourceKind,
  CoverageMatchDetail,
  CoverageMode,
  CoverageNearMissDetail,
  FallbackKind,
  GoldCoverageSummary,
  MatchKind,
  NarrowComparisonCandidateReport,
  NarrowComparisonReport,
  NarrowComparisonVideoReport,
  NarrowRunMode,
  NarrowStageId,
  TimeoutSource,
} from "./narrow-report-types.js";

export const NarrowCorpusSchema = z.array(CorpusEntrySchema).min(1);

const DEFAULT_EMBEDDING_BUDGET_PER_RUN = 250;
const DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN = 4;
export interface RunNarrowManualBaselineOptions {
  corpus: CorpusEntry[];
  transcriptDir: string;
  manualBaselineDir: string;
  outputDir: string;
  models: EvalModel[];
  variants: ExtractorVariantId[];
  judgeModelIds: string[];
  fallbackModelId: string;
  config: ResolvedConfig;
  clientFactory: (modelId: string) => LlmClient;
  maxConcurrency?: number;
  timeoutMs?: number;
  judgeMaxTokens?: number;
  runMode?: NarrowRunMode;
  shortlistPerVideo?: number;
  maxEmbeddingRequestsPerRun?: number;
  maxRefinedSelfImproveCellsPerRun?: number;
  judgeEnabled?: boolean;
  includeManualBaselines?: boolean;
  maxEmbeddingRequestsPerMinute?: number;
  /**
   * Explicit runtime environment snapshot.
   *
   * This lets callers forward dotenv-loaded values without mutating
   * process.env globally.
   */
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export { renderNarrowComparisonMarkdown } from "./narrow-report-renderer.js";
export { writeNarrowComparisonReport } from "./narrow-report-writer.js";
export { computeCoverageByMode, type EmbeddingBudgetState } from "./coverage-engine.js";

export async function runNarrowManualBaselineComparison(
  options: RunNarrowManualBaselineOptions
): Promise<NarrowComparisonReport> {
  const startedAt = new Date().toISOString();
  const logger = options.logger ?? consoleLogger;
  requestRateLimiterRegistry.reset();
  const runMode = options.runMode ?? "fast-triage";
  const preset = getNarrowModePreset(runMode);
  const chunkModes = [...preset.chunkModes];
  const promptConfigs = [...preset.promptConfigs];
  const stage1Variants = intersectVariants(options.variants, preset.stage1Variants);
  const stage2Variants = intersectVariants(options.variants, preset.stage2Variants);
  const shortlistPerVideo = options.shortlistPerVideo ?? preset.shortlistPerVideo;
  const judgeEnabled = options.judgeEnabled ?? preset.judgeEnabled;
  const includeManualBaselines = options.includeManualBaselines ?? preset.includeManualBaselines;
  const enablePromptRouting = runMode === "deep";
  const adaptiveEscalation = runMode === "fast-triage";
  const budgetSkips: string[] = [];
  const stageExecution: Record<NarrowStageId, "resumed" | "recomputed" | "skipped"> = {
    shortlist: "recomputed",
    refine: "recomputed",
    score: "recomputed",
    judge: "recomputed",
    report: "recomputed",
  };
  const budgetState = {
    remainingEmbeddingRequests: options.maxEmbeddingRequestsPerRun ?? DEFAULT_EMBEDDING_BUDGET_PER_RUN,
    remainingRefinedSelfImproveCells: options.maxRefinedSelfImproveCellsPerRun ?? DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN,
  };
  const transcriptByVideo = new Map<string, TranscriptData>();
  const goldByVideo = new Map<string, FlattenedGoldenClaimNode[]>();
  const manualByVideo = new Map<string, ComparableClaimSet[]>();
  const corpusSignature = buildCorpusSignature(options.corpus);
  const runtimeEnv = options.env ?? process.env;

  const googleEmbeddingConfig = getGoogleEmbeddingConfig(options.config, runtimeEnv);
  const embeddingClientAvailable = Boolean(googleEmbeddingConfig.apiKey && preset.enableEmbeddings);

  const stageInputSignature = await buildStageInputSignature({
    corpusSignature,
    runMode,
    corpus: options.corpus,
    modelIds: options.models.map((model) => model.id),
    chunkModes,
    promptConfigs,
    stage1Variants,
    stage2Variants,
    transcriptDir: options.transcriptDir,
    manualBaselineDir: options.manualBaselineDir,
    fallbackModelId: options.fallbackModelId,
    judgeEnabled,
    judgeModelIds: options.judgeModelIds,
    judgeMaxTokens: options.judgeMaxTokens ?? 4000,
    includeManualBaselines,
    enablePromptRouting,
    maxEmbeddingRequestsPerRun: options.maxEmbeddingRequestsPerRun,
    maxRefinedSelfImproveCellsPerRun: options.maxRefinedSelfImproveCellsPerRun,
    shortlistPerVideo,
    embeddingClientAvailable,
    embeddingModel: googleEmbeddingConfig.model,
    embeddingBaseUrl: googleEmbeddingConfig.baseUrl,
    embeddingBatchSize: googleEmbeddingConfig.batchSize,
    taskType: googleEmbeddingConfig.taskType,
    outputDimensionality: googleEmbeddingConfig.outputDimensionality,
  });
  const extractionStageInputSignature = await buildExtractionStageInputSignature({
    corpusSignature,
    corpus: options.corpus,
    modelIds: options.models.map((model) => model.id),
    chunkModes,
    promptConfigs,
    stage1Variants,
    stage2Variants,
    transcriptDir: options.transcriptDir,
    manualBaselineDir: options.manualBaselineDir,
    fallbackModelId: options.fallbackModelId,
    judgeModelIds: options.judgeModelIds,
    judgeMaxTokens: options.judgeMaxTokens ?? 4000,
    enablePromptRouting,
    includeManualBaselines,
    maxEmbeddingRequestsPerRun: options.maxEmbeddingRequestsPerRun,
    maxRefinedSelfImproveCellsPerRun: options.maxRefinedSelfImproveCellsPerRun,
    shortlistPerVideo,
    embeddingModel: googleEmbeddingConfig.model,
    embeddingBaseUrl: googleEmbeddingConfig.baseUrl,
    embeddingBatchSize: googleEmbeddingConfig.batchSize,
    taskType: googleEmbeddingConfig.taskType,
    outputDimensionality: googleEmbeddingConfig.outputDimensionality,
  });

  await Promise.all(options.corpus.map(async (video) => {
    const [transcript, loaded] = await Promise.all([
      loadTranscript(video, options.transcriptDir),
      loadVideoBaselines(video.videoId, options.manualBaselineDir, { includeManualBaselines }),
    ]);
    transcriptByVideo.set(video.videoId, transcript);
    goldByVideo.set(video.videoId, loaded.goldFlatClaims);
    manualByVideo.set(video.videoId, loaded.comparableClaimSets);
  }));

  const embeddingClient = embeddingClientAvailable
    ? createGoogleEmbeddingClient(googleEmbeddingConfig, {
        cacheDir: join(options.outputDir, ".cache", "eval-embeddings"),
        timeoutMs: options.timeoutMs ?? 120_000,
        maxRequestsPerMinute: options.maxEmbeddingRequestsPerMinute ?? 80,
        logger,
      })
    : undefined;

  const buildVideoReports = (input: {
    harnessCells: MatrixCell[];
    fallbackCells: MatrixCell[];
    fallbackTriggeredFor: string[];
  }) => createNarrowVideoReportBuilder({
    corpus: options.corpus,
    transcriptByVideo,
    goldByVideo,
    manualByVideo,
    fallbackCells: input.fallbackCells,
    fallbackTriggeredFor: input.fallbackTriggeredFor,
    embeddingClient,
    budgetState,
    budgetSkips,
    logger,
  }).buildVideoReports({
    harnessCells: input.harnessCells,
    includeManualBaselines,
  });
  const shortlistStage = createNarrowShortlistStage({
    corpus: options.corpus,
    models: options.models,
    stage1Variants,
    runMode,
    outputDir: options.outputDir,
    transcriptDir: options.transcriptDir,
    fallbackModelId: options.fallbackModelId,
    chunkModes,
    promptConfigs,
    shortlistPerVideo,
    adaptiveEscalation,
    enablePromptRouting,
    inputSignature: extractionStageInputSignature,
    clientFactory: options.clientFactory,
    maxConcurrency: options.maxConcurrency ?? 1,
    timeoutMs: options.timeoutMs ?? 120_000,
    buildVideoReports,
    includeManualBaselines,
    logger,
  });
  const shortlistStageResult = await shortlistStage.run();
  stageExecution.shortlist = shortlistStageResult.execution;
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
    judgeEnabled
      ? options.judgeModelIds.map((judgeModelId) => [judgeModelId, options.clientFactory(judgeModelId)])
      : []
  );
  const videoReportBuilder = createNarrowVideoReportBuilder({
    corpus: options.corpus,
    transcriptByVideo,
    goldByVideo,
    manualByVideo,
    fallbackCells,
    fallbackTriggeredFor,
    embeddingClient,
    budgetState,
    budgetSkips,
    logger,
  });
  const scoreStage = createNarrowScoreStage({
    corpus: options.corpus,
    runMode,
    outputDir: options.outputDir,
    transcriptByVideo,
    goldByVideo,
    manualByVideo,
    fallbackCells,
    fallbackTriggeredFor,
    enableEmbeddings: preset.enableEmbeddings,
    embeddingClientAvailable,
    embeddingModel: googleEmbeddingConfig.model,
    embeddingBaseUrl: googleEmbeddingConfig.baseUrl,
    embeddingBatchSize: googleEmbeddingConfig.batchSize,
    maxEmbeddingRequestsPerRun: options.maxEmbeddingRequestsPerRun,
    taskType: googleEmbeddingConfig.taskType,
    outputDimensionality: googleEmbeddingConfig.outputDimensionality,
    videoReportBuilder,
    logger,
  });
  const judgeStage = createNarrowJudgeStage({
    outputDir: options.outputDir,
    transcriptByVideo,
    goldByVideo,
    manualByVideo,
    fallbackCells,
    fallbackTriggeredFor,
    shortlistPerVideo,
    judgeClients,
    judgeModelIds: options.judgeModelIds,
    judgeMaxTokens: options.judgeMaxTokens ?? 4000,
    logger,
  });
  const refineStage = createNarrowRefineStage({
    corpus: options.corpus,
    models: options.models,
    stage2Variants,
    runMode,
    outputDir: options.outputDir,
    transcriptDir: options.transcriptDir,
    clientFactory: options.clientFactory,
    maxConcurrency: options.maxConcurrency ?? 1,
    timeoutMs: options.timeoutMs ?? 120_000,
    enablePromptRouting,
    remainingRefinedSelfImproveCells: () => budgetState.remainingRefinedSelfImproveCells,
    budgetSkips,
    logger,
  });

  const teacherAwareHints = includeManualBaselines ? buildTeacherAwareHints(initialVideos) : {};
  const refineStageResult = await refineStage.run({
    extractionStageInputSignature,
    shortlistTargets,
    initialHarnessCells,
    teacherAwareHints,
  });
  stageExecution.refine = refineStageResult.execution;
  const refinedTargets = refineStageResult.refinedTargets;
  const refinedSelfImproveCells = refineStageResult.refinedSelfImproveCells;
  const finalHarnessCells = refineStageResult.finalHarnessCells;
  const scoreStageResult = await scoreStage.run({
    stageInputSignature,
    corpusSignature,
    shortlistTargets,
    refinedSelfImproveCells,
    finalHarnessCells,
    includeManualBaselines,
  });
  stageExecution.score = scoreStageResult.execution;
  let videos = scoreStageResult.videos;
  if (judgeEnabled) {
    const judgeStageResult = await judgeStage.run({
      stageInputSignature,
      runMode,
      videos,
      harnessCells: finalHarnessCells,
      includeManualBaselines,
    });
    stageExecution.judge = judgeStageResult.execution;
    videos = judgeStageResult.videos;
  } else {
    logger.info("[stage4-start] judge");
    logger.info("[stage4-done] judge");
    budgetSkips.push("judge-disabled-by-mode");
    stageExecution.judge = "skipped";
  }

  if (!preset.enableEmbeddings) {
    budgetSkips.push("embeddings-disabled-by-mode");
  }
  if (!includeManualBaselines) {
    budgetSkips.push("manual-baselines-skipped-by-mode");
  }

  const embeddingStats = embeddingClient?.getStats() ?? { apiRequestCount: 0, embeddingsComputed: 0, cacheHitCount: 0, cacheMissCount: 0 };

  return {
    metadata: buildNarrowReportMetadata({
      startedAt,
      completedAt: new Date().toISOString(),
      runMode,
      judgeEnabled,
      judgeModelIds: options.judgeModelIds,
      requestedModels: options.models,
      chunkModes,
      promptConfigs,
      stage1Variants,
      stage2Variants,
      shortlistPerVideo,
      fallbackModelId: options.fallbackModelId,
      fallbackTriggeredFor,
      manualBaselineDir: options.manualBaselineDir,
      transcriptDir: options.transcriptDir,
      refinedTargetCount: refinedTargets.length,
      embeddingModel: googleEmbeddingConfig.model ?? DEFAULT_GOOGLE_EMBEDDING_MODEL,
      budgetSkips,
      stageExecution,
      includeManualBaselines,
      embeddingStats,
      rateLimitStatsByModel: requestRateLimiterRegistry.getStats(),
      adaptiveEscalation,
      escalatedVideos,
      escalationReasonsByVideo,
    }),
    videos,
  };
}
