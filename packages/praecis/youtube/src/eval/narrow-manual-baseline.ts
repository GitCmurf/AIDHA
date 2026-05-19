import { z } from "zod";
import { CorpusEntrySchema } from "./corpus-schema.js";
import { RequestRateLimiterRegistry, requestRateLimiterRegistry as globalRegistry } from "./request-rate-limiter.js";
import { consoleLogger } from "../utils/logger.js";
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
import { DEFAULT_GOOGLE_EMBEDDING_MODEL } from "./narrow-embedding-config.js";
import type {
  NarrowComparisonReport,
} from "./narrow-report-types.js";
import type { RunNarrowManualBaselineOptions } from "./narrow-run-options.js";
import { buildNarrowReportMetadata } from "./narrow-report-metadata.js";
import { prepareNarrowBaselineRunContext } from "./narrow-run-context.js";
import { runNarrowBaselineStagePipeline } from "./narrow-stage-pipeline.js";

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

export type { RunNarrowManualBaselineOptions } from "./narrow-run-options.js";

export { renderNarrowComparisonMarkdown } from "./narrow-report-renderer.js";
export { writeNarrowComparisonReport } from "./narrow-report-writer.js";
export { computeCoverageByMode, type EmbeddingBudgetState } from "./coverage-engine.js";

export async function runNarrowManualBaselineComparison(
  options: RunNarrowManualBaselineOptions
): Promise<NarrowComparisonReport> {
  const startedAt = new Date().toISOString();
  const logger = options.logger ?? consoleLogger;
  const registry = options.rateLimiterRegistry ?? new RequestRateLimiterRegistry();
  if (!options.rateLimiterRegistry) {
    registry.reset();
  }
  const context = await prepareNarrowBaselineRunContext(options, logger);
  const {
    fallbackTriggeredFor,
    refinedTargets,
    videos,
    escalatedVideos,
    escalationReasonsByVideo,
  } = await runNarrowBaselineStagePipeline(options, context, logger);

  if (!context.preset.enableEmbeddings) {
    context.budgetSkips.push("embeddings-disabled-by-mode");
  }
  if (!context.includeManualBaselines) {
    context.budgetSkips.push("manual-baselines-skipped-by-mode");
  }

  const embeddingStats = context.embeddingClient?.getStats()
    ?? { apiRequestCount: 0, embeddingsComputed: 0, cacheHitCount: 0, cacheMissCount: 0 };

  return {
    metadata: buildNarrowReportMetadata({
      startedAt,
      completedAt: new Date().toISOString(),
      runMode: context.runMode,
      judgeEnabled: context.judgeEnabled,
      judgeModelIds: options.judgeModelIds,
      requestedModels: options.models,
      chunkModes: context.chunkModes,
      promptConfigs: context.promptConfigs,
      stage1Variants: context.stage1Variants,
      stage2Variants: context.stage2Variants,
      shortlistPerVideo: context.shortlistPerVideo,
      fallbackModelId: options.fallbackModelId,
      fallbackTriggeredFor,
      manualBaselineDir: options.manualBaselineDir,
      transcriptDir: options.transcriptDir,
      refinedTargetCount: refinedTargets.length,
      embeddingModel: context.googleEmbeddingConfig.model ?? DEFAULT_GOOGLE_EMBEDDING_MODEL,
      budgetSkips: context.budgetSkips,
      stageExecution: context.stageExecution,
      includeManualBaselines: context.includeManualBaselines,
      embeddingStats,
      rateLimitStatsByModel: registry.getStats(),
      adaptiveEscalation: context.adaptiveEscalation,
      escalatedVideos,
      escalationReasonsByVideo,
    }),
    videos,
  };
}
