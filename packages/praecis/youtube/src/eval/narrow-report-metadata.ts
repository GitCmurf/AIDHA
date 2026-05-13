import type { EvalModel } from "./model-registry.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type {
  NarrowComparisonReport,
  NarrowRunMode,
  NarrowStageId,
} from "./narrow-report-types.js";

export interface NarrowEmbeddingStatsSnapshot {
  apiRequestCount: number;
  embeddingsComputed: number;
  cacheHitCount: number;
  cacheMissCount: number;
}

export interface BuildNarrowReportMetadataInput {
  startedAt: string;
  completedAt: string;
  runMode: NarrowRunMode;
  judgeEnabled: boolean;
  judgeModelIds: string[];
  requestedModels: EvalModel[];
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  stage1Variants: ExtractorVariantId[];
  stage2Variants: ExtractorVariantId[];
  shortlistPerVideo: number;
  fallbackModelId: string;
  fallbackTriggeredFor: string[];
  manualBaselineDir: string;
  transcriptDir: string;
  refinedTargetCount: number;
  embeddingModel: string;
  budgetSkips: string[];
  stageExecution: Record<NarrowStageId, "resumed" | "recomputed" | "skipped">;
  includeManualBaselines: boolean;
  embeddingStats: NarrowEmbeddingStatsSnapshot;
  rateLimitStatsByModel: NarrowComparisonReport["metadata"]["rateLimitStatsByModel"];
  adaptiveEscalation: boolean;
  escalatedVideos: string[];
  escalationReasonsByVideo: Record<string, string[]>;
}

export function buildNarrowReportMetadata(
  input: BuildNarrowReportMetadataInput
): NarrowComparisonReport["metadata"] {
  return {
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    runMode: input.runMode,
    judgeModelIds: input.judgeEnabled ? input.judgeModelIds : [],
    requestedModels: input.requestedModels.map((model) => model.id),
    chunkModes: input.chunkModes,
    promptConfigs: input.promptConfigs,
    variants: [...new Set([...input.stage1Variants, ...input.stage2Variants])],
    teacherSelectionMode: "manual-baseline-best-by-gold-coverage",
    judgedTopHarnessPerVideo: input.shortlistPerVideo,
    fallbackModelId: input.fallbackModelId,
    fallbackTriggeredFor: input.fallbackTriggeredFor,
    manualBaselineDir: input.manualBaselineDir,
    transcriptDir: input.transcriptDir,
    shortlistSizePerVideo: input.shortlistPerVideo,
    refinedTargetCount: input.refinedTargetCount,
    embeddingModel: input.embeddingModel,
    completedStages: [
      ...(Object.entries(input.stageExecution) as [NarrowStageId, string][])
        .filter(([, status]) => status === "resumed" || status === "recomputed")
        .map(([stage]) => stage),
      "report",
    ] as NarrowStageId[],
    budgetSkips: input.budgetSkips,
    stageExecution: input.stageExecution,
    judgeEnabled: input.judgeEnabled,
    manualBaselinesIncluded: input.includeManualBaselines,
    apiCallCounts: {
      apiRequests: input.embeddingStats.apiRequestCount,
      embeddingRequests: input.embeddingStats.embeddingsComputed,
      embeddingCacheHits: input.embeddingStats.cacheHitCount,
      embeddingCacheMisses: input.embeddingStats.cacheMissCount,
    },
    rateLimitStatsByModel: input.rateLimitStatsByModel,
    adaptiveEscalation: input.adaptiveEscalation,
    escalatedVideos: input.escalatedVideos,
    escalationReasonsByVideo: input.escalationReasonsByVideo,
  };
}
