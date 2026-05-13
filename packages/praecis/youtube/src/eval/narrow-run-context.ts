import { join } from "node:path";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { Logger } from "../utils/logger.js";
import {
  createGoogleEmbeddingClient,
  getGoogleEmbeddingConfig,
} from "./narrow-embedding-config.js";
import {
  buildExtractionStageInputSignature,
  buildStageInputSignature,
} from "./narrow-stage-signatures.js";
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
import type {
  ComparableClaimSet,
  NarrowStageId,
} from "./narrow-report-types.js";
import type { RunNarrowManualBaselineOptions } from "./narrow-run-options.js";
import {
  DEFAULT_EMBEDDING_BUDGET_PER_RUN,
  DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN,
} from "./narrow-run-options.js";

export interface NarrowBaselineRunContext {
  runMode: NonNullable<RunNarrowManualBaselineOptions["runMode"]>;
  preset: ReturnType<typeof getNarrowModePreset>;
  chunkModes: ReturnType<typeof getNarrowModePreset>["chunkModes"];
  promptConfigs: ReturnType<typeof getNarrowModePreset>["promptConfigs"];
  stage1Variants: ReturnType<typeof intersectVariants>;
  stage2Variants: ReturnType<typeof intersectVariants>;
  shortlistPerVideo: number;
  judgeEnabled: boolean;
  includeManualBaselines: boolean;
  enablePromptRouting: boolean;
  adaptiveEscalation: boolean;
  budgetSkips: string[];
  stageExecution: Record<NarrowStageId, "resumed" | "recomputed" | "skipped">;
  budgetState: {
    remainingEmbeddingRequests: number;
    remainingRefinedSelfImproveCells: number;
  };
  transcriptByVideo: Map<string, TranscriptData>;
  goldByVideo: Map<string, FlattenedGoldenClaimNode[]>;
  manualByVideo: Map<string, ComparableClaimSet[]>;
  corpusSignature: string;
  googleEmbeddingConfig: ReturnType<typeof getGoogleEmbeddingConfig>;
  embeddingClientAvailable: boolean;
  embeddingClient: ReturnType<typeof createGoogleEmbeddingClient> | undefined;
  stageInputSignature: string;
  extractionStageInputSignature: string;
}

export async function prepareNarrowBaselineRunContext(
  options: RunNarrowManualBaselineOptions,
  logger: Logger
): Promise<NarrowBaselineRunContext> {
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
    remainingRefinedSelfImproveCells: options.maxRefinedSelfImproveCellsPerRun
      ?? DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN,
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

  return {
    runMode,
    preset,
    chunkModes,
    promptConfigs,
    stage1Variants,
    stage2Variants,
    shortlistPerVideo,
    judgeEnabled,
    includeManualBaselines,
    enablePromptRouting,
    adaptiveEscalation,
    budgetSkips,
    stageExecution,
    budgetState,
    transcriptByVideo,
    goldByVideo,
    manualByVideo,
    corpusSignature,
    googleEmbeddingConfig,
    embeddingClientAvailable,
    embeddingClient,
    stageInputSignature,
    extractionStageInputSignature,
  };
}
