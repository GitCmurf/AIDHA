import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ResolvedConfig } from "@aidha/config";
import type { ClaimCandidate, LlmClient } from "../extract/index.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import { CorpusEntrySchema, type CorpusEntry } from "./corpus-schema.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import { getModel, type EvalModel } from "./model-registry.js";
import { requestRateLimiterRegistry } from "./request-rate-limiter.js";
import { consoleLogger, type Logger } from "../utils/logger.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import { renderNarrowComparisonMarkdown } from "./narrow-report-renderer.js";
import type { NarrowDerivedJudgeScores, NarrowJudgeFindings } from "./narrow-judge.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type { ExtractionPromptPackId } from "../extract/prompt-routing.js";
import {
  computeCoverageByMode,
  type CoverageCacheKey,
  type EmbeddingBudgetState,
} from "./coverage-engine.js";
import {
  readNarrowStageArtifact,
  readNarrowVideoScoreArtifact,
  writeNarrowStageArtifact,
  writeNarrowVideoScoreArtifact,
  type NarrowJudgeStageArtifact,
  type NarrowRefineStageArtifact,
  type NarrowScoreStageArtifact,
  type NarrowShortlistStageArtifact,
  type NarrowShortlistTarget,
  type NarrowVideoScoreArtifact,
} from "./stage-artifact-store.js";
import {
  buildTeacherAwareHints,
  enrichReportsWithTeacherData,
  selectTeacherComparableCandidate,
  selfImproveHintKey,
  type SelfImproveHintInput,
} from "./teacher-analysis.js";
import { enrichCandidateReportWithJudges } from "./narrow-judge-enrichment.js";
import {
  annotateOptimizationRanks,
  compareOptimizationPriority,
  computeOptimizationScore,
} from "./narrow-optimization-ranking.js";
import {
  assessStructuralTargets,
  profileTranscriptStructure,
  type StructuralTargetAssessment,
  type TranscriptStructureProfile,
} from "./narrow-structural-targets.js";
import {
  buildComparableCandidateId,
  buildComparableClaimSetIndex,
  buildComparableClaimSetsForVideo,
  buildHarnessComparableClaimSet,
  needsFallbackForModel,
  type ComparableClaimSetIndex,
} from "./narrow-comparable-claim-set.js";
import {
  backfillTranscriptStructureProfile,
  buildCandidateReport,
} from "./narrow-candidate-report.js";
import {
  buildExtractionStageInputSignature,
  buildRefineStageInputSignature,
  buildStageInputSignature,
  buildVideoScoreInputSignature,
} from "./narrow-stage-signatures.js";
import { runHarnessExtractionOnly } from "./narrow-harness-extraction.js";
import {
  createGoogleEmbeddingClient,
  DEFAULT_GOOGLE_EMBEDDING_MODEL,
  getGoogleEmbeddingConfig,
} from "./narrow-embedding-config.js";
import {
  getNarrowModePreset,
  intersectVariants,
  selectFastTriageEscalationPack,
  selectShortlistCandidatesForVideo,
} from "./narrow-mode-selection.js";
import {
  loadTranscript,
  loadVideoBaselines,
  type TranscriptData,
} from "./narrow-input-loader.js";
import { buildCorpusSignature } from "./narrow-corpus-signature.js";
import { buildEmbeddingEligibleCandidateIdsByVideo } from "./narrow-embedding-eligibility.js";

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

export const NarrowCorpusSchema = z.array(CorpusEntrySchema).min(1);

const DEFAULT_EMBEDDING_BUDGET_PER_RUN = 250;
const DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN = 4;
export type NarrowRunMode = "fast-triage" | "compare" | "deep";
export type NarrowStageId = "shortlist" | "refine" | "score" | "judge" | "report";

export type ComparableSourceKind = "harness" | "manual-baseline" | "fallback-harness";
export type CoverageMode = "strict" | "semantic" | "embedding";
export type MatchKind = "exact" | "lexical" | "proxy-semantic" | "embedding";
export type FallbackKind = "none" | "partial" | "full";
export type TimeoutSource = "none" | "llm_client_timeout" | "matrix_cell_timeout" | "upstream_abort";

export interface CandidateDiagnostics {
  timeoutSource: TimeoutSource;
  retryCount: number;
  fallbackKind: FallbackKind;
  transientFailureCount: number;
  clientTimeoutCount: number;
  upstreamAbortCount: number;
  maxChunkInputTokens: number;
  chunkInputTokenCounts: number[];
  selfImproveRoundCount: number;
  promptPackId?: string;
  routeSource?: string;
  routeConfidence?: number;
  routeSignals?: string[];
  retryTriggered?: boolean;
  retryReason?: string;
  retryPromptPackId?: string;
}

export interface ComparableClaimSet {
  videoId: string;
  candidateId: string;
  sourceKind: ComparableSourceKind;
  claims: ClaimCandidate[];
  modelId?: string;
  variantId?: string;
  chunkMode?: NarrowEvalChunkMode;
  promptConfigId?: Pass1PromptConfigId;
  note?: string;
  error?: string;
  diagnostics?: CandidateDiagnostics;
}

export interface CoverageMatchDetail {
  goldId: string;
  goldText: string;
  candidateText: string;
  candidateIndex: number;
  kind: MatchKind;
  lexicalScore: number;
  proxySemanticScore: number;
  embeddingScore?: number;
}

export interface CoverageNearMissDetail {
  goldId: string;
  goldText: string;
  candidateText?: string;
  lexicalScore: number;
  proxySemanticScore: number;
  embeddingScore?: number;
}

export interface GoldCoverageSummary {
  matched: number;
  total: number;
  ratio: number;
  rootsMatched: number;
  rootsTotal: number;
  rootRatio: number;
  childrenMatched: number;
  childrenTotal: number;
  childRatio: number;
  unmatchedGoldClaims: Array<{ id: string; text: string; depth: number }>;
  unmatchedCandidateClaims: Array<{ text: string }>;
  matchedPairs: CoverageMatchDetail[];
  nearestMisses: CoverageNearMissDetail[];
}

export interface NarrowComparisonCandidateReport {
  candidateId: string;
  sourceKind: ComparableSourceKind;
  modelId?: string;
  variantId?: string;
  chunkMode?: NarrowEvalChunkMode;
  promptConfigId?: Pass1PromptConfigId;
  note?: string;
  claimCount: number;
  structuralTargetScore?: number;
  structuralTargetAssessment?: {
    hasRootCardinalityClaim: boolean;
    hasMemberListClaim: boolean;
    hasAvoidRuleClaim: boolean;
    passesShortlistGate: boolean;
  };
  optimizationScore?: number;
  rankWithinVideo?: number;
  rankOverall?: number;
  selectedBestForVideo?: boolean;
  selectedBestOverall?: boolean;
  judgeFindingsByModel?: Record<string, NarrowJudgeFindings>;
  derivedScoresByModel?: Record<string, NarrowDerivedJudgeScores>;
  judgeDisagreement?: {
    models: string[];
    overallSpread: number;
    goldCoverageSpread: number;
  };
  strictCoverage: GoldCoverageSummary;
  semanticCoverage: GoldCoverageSummary;
  embeddingCoverage?: GoldCoverageSummary;
  teacherCandidateId?: string;
  teacherCoverage?: GoldCoverageSummary;
  gapSummary?: {
    missingGoldRoots: string[];
    missingGoldFrameworkClaims: string[];
    missingTeacherClaims: string[];
    extraCandidateClaims: string[];
  };
  goldCoverage: GoldCoverageSummary;
  diagnostics?: CandidateDiagnostics;
  error?: string;
}

export interface NarrowComparisonVideoReport {
  videoId: string;
  title: string;
  transcriptStructureProfile: {
    tags: string[];
    cueMatches: string[];
  };
  candidateReports: NarrowComparisonCandidateReport[];
}

export interface NarrowComparisonReport {
  metadata: {
    startedAt: string;
    completedAt: string;
    runMode: NarrowRunMode;
    judgeModelIds: string[];
    requestedModels: string[];
    chunkModes: NarrowEvalChunkMode[];
    promptConfigs: Pass1PromptConfigId[];
    variants: string[];
    teacherSelectionMode: string;
    judgedTopHarnessPerVideo: number;
    fallbackModelId: string;
    fallbackTriggeredFor: string[];
    manualBaselineDir: string;
    transcriptDir: string;
    shortlistSizePerVideo: number;
    refinedTargetCount: number;
    embeddingModel: string;
    completedStages: NarrowStageId[];
    budgetSkips: string[];
    stageExecution: Record<NarrowStageId, "resumed" | "recomputed" | "skipped">;
    judgeEnabled: boolean;
    manualBaselinesIncluded: boolean;
    apiCallCounts: {
      apiRequests: number;
      embeddingRequests: number;
      embeddingCacheHits: number;
      embeddingCacheMisses: number;
    };
    rateLimitStatsByModel: Record<string, { requests: number; waitMs: number }>;
    adaptiveEscalation?: boolean;
    escalatedVideos?: string[];
    escalationReasonsByVideo?: Record<string, string[]>;
  };
  videos: NarrowComparisonVideoReport[];
}

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

  const fallbackTriggeredFor: string[] = [];
  let fallbackCells: MatrixCell[] = [];
  let initialHarnessCells: MatrixCell[] = [];
  let initialVideos: NarrowComparisonVideoReport[] = [];
  let shortlistTargets: NarrowShortlistTarget[] = [];
  let escalatedVideos: string[] = [];
  let escalationReasonsByVideo: Record<string, string[]> = {};
  const cachedShortlist = await readNarrowStageArtifact<NarrowShortlistStageArtifact>(options.outputDir, "shortlist");
  if (cachedShortlist?.inputSignature === extractionStageInputSignature) {
    logger.info("[resume-from] stage=shortlist");
    stageExecution.shortlist = "resumed";
    initialHarnessCells = cachedShortlist.initialHarnessCells;
    fallbackTriggeredFor.push(...cachedShortlist.fallbackTriggeredFor);
    fallbackCells = cachedShortlist.fallbackCells;
    initialVideos = cachedShortlist.videos;
    shortlistTargets = cachedShortlist.shortlistTargets;
    escalatedVideos = cachedShortlist.escalatedVideos ?? [];
    escalationReasonsByVideo = cachedShortlist.escalationReasonsByVideo ?? {};
  } else {
    logger.info("[stage1-start] shortlist");
    for (const promptConfigId of promptConfigs) {
      for (const chunkMode of chunkModes) {
        initialHarnessCells.push(...await runHarnessExtractionOnly(
          options.corpus,
          options.models,
          stage1Variants,
          promptConfigId,
          chunkMode,
          options.transcriptDir,
          options.clientFactory,
          options.maxConcurrency ?? 1,
          options.timeoutMs ?? 120_000,
          undefined,
          enablePromptRouting,
          undefined,
          undefined,
          options.outputDir,
          join(options.outputDir, ".cache", "extraction"),
          logger
        ));
      }
    }

    const fallbackModel = options.models.find((model) => model.id === options.fallbackModelId) || getModel(options.fallbackModelId);
    if (fallbackModel) {
      const fallbackTargets = options.models
        .filter((model) => model.id !== options.fallbackModelId)
        .filter((model) => needsFallbackForModel(initialHarnessCells, model.id));

      if (fallbackTargets.length > 0) {
        fallbackTriggeredFor.push(...fallbackTargets.map((model) => model.id));
        for (const promptConfigId of promptConfigs) {
          for (const chunkMode of chunkModes) {
            fallbackCells.push(...await runHarnessExtractionOnly(
              options.corpus,
              [fallbackModel],
              stage1Variants,
              promptConfigId,
              chunkMode,
              options.transcriptDir,
              options.clientFactory,
              options.maxConcurrency ?? 1,
              options.timeoutMs ?? 120_000,
              undefined,
              enablePromptRouting,
              undefined,
              undefined,
              options.outputDir,
              join(options.outputDir, ".cache", "extraction"),
              logger
            ));
          }
        }
      }
    }

  }

  const judgeClients = new Map(
    judgeEnabled
      ? options.judgeModelIds.map((judgeModelId) => [judgeModelId, options.clientFactory(judgeModelId)])
      : []
  );
  // This set is read while building shortlist-stage video reports, so it must
  // exist before the helper closures are created to avoid a TDZ on fresh runs.
  const buildSingleVideoReport = async (
    video: CorpusEntry,
    comparableClaimSetIndex: ComparableClaimSetIndex,
    includeManualBaselinesForVideo: boolean,
    embeddingEligibleCandidateIdsByVideo?: Map<string, Set<string>>
  ): Promise<NarrowComparisonVideoReport> => {
    const coverageStartedAt = Date.now();
    logger.info(`[coverage-start] video=${video.videoId}`);
    const transcript = transcriptByVideo.get(video.videoId);
    const goldClaims = goldByVideo.get(video.videoId);
    if (!transcript || !goldClaims) {
      throw new Error(`Missing transcript or gold baseline for ${video.videoId}`);
    }
    const transcriptProfile = transcript.structureProfile;

    const comparableClaimSets = buildComparableClaimSetsForVideo(
      video.videoId,
      comparableClaimSetIndex,
      manualByVideo,
      includeManualBaselinesForVideo
    );
    const coverageCache = new Map<CoverageCacheKey, GoldCoverageSummary>();
    const embeddingEligibleCandidateIds = embeddingEligibleCandidateIdsByVideo?.get(video.videoId);
    let effectiveEmbeddingClient = embeddingClient && embeddingEligibleCandidateIds && embeddingEligibleCandidateIds.size > 0
      ? embeddingClient
      : undefined;
    if (effectiveEmbeddingClient && budgetState.remainingEmbeddingRequests <= 0) {
      budgetSkips.push(`embedding-budget-exceeded:${video.videoId}:0`);
      effectiveEmbeddingClient = undefined;
      logger.warn(`[embedding-skip-budget] video=${video.videoId} required=1 remaining=0`);
    }

    const candidateReports: NarrowComparisonCandidateReport[] = [];
    for (const [candidateIndex, candidate] of comparableClaimSets.entries()) {
      if (effectiveEmbeddingClient && budgetState.remainingEmbeddingRequests <= 0) {
        effectiveEmbeddingClient = undefined;
        logger.warn(`[embedding-skip-budget] video=${video.videoId} candidate=${candidate.candidateId} remaining=0`);
      }

      candidateReports.push(await buildCandidateReport(
        candidate,
        goldClaims,
        transcriptProfile,
        embeddingEligibleCandidateIds?.has(candidate.candidateId) ? effectiveEmbeddingClient : undefined,
        coverageCache,
        budgetState
      ));

      logger.info(
        `[coverage-candidate] video=${video.videoId} index=${candidateIndex + 1}/${comparableClaimSets.length} candidate=${candidate.candidateId}`
      );
    }

    if (includeManualBaselinesForVideo) {
      if (effectiveEmbeddingClient && budgetState.remainingEmbeddingRequests <= 0) {
        effectiveEmbeddingClient = undefined;
        logger.warn(`[embedding-skip-budget] video=${video.videoId} phase=teacher remaining=0`);
      }

      await enrichReportsWithTeacherData(
        candidateReports,
        comparableClaimSets,
        effectiveEmbeddingClient,
        coverageCache,
        embeddingEligibleCandidateIds,
        budgetState
      );
    }
    logger.info(`[coverage-done] video=${video.videoId} durationMs=${Date.now() - coverageStartedAt}`);
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

  const buildVideoReports = async (
    harnessCells: MatrixCell[],
    includeManualBaselines: boolean,
    runJudges: boolean,
    embeddingEligibleCandidateIdsByVideo?: Map<string, Set<string>>
  ): Promise<NarrowComparisonVideoReport[]> => {
    const videos: NarrowComparisonVideoReport[] = [];
    const comparableClaimSetIndex = buildComparableClaimSetIndex(
      harnessCells,
      fallbackCells,
      `Fallback for unavailable or degraded model rows: ${fallbackTriggeredFor.join(", ")}`
    );

    for (const video of options.corpus) {
      videos.push(await buildSingleVideoReport(
        video,
        comparableClaimSetIndex,
        includeManualBaselines,
        embeddingEligibleCandidateIdsByVideo
      ));
    }

    annotateOptimizationRanks(videos);

    if (!runJudges) {
      return videos;
    }

    for (const video of videos) {
      const transcript = transcriptByVideo.get(video.videoId);
      const goldClaims = goldByVideo.get(video.videoId);
      if (!transcript || !goldClaims) {
        throw new Error(`Missing transcript or gold baseline for ${video.videoId}`);
      }
      const comparableClaimSets = buildComparableClaimSetsForVideo(
        video.videoId,
        comparableClaimSetIndex,
        manualByVideo,
        includeManualBaselines
      );
      const candidateById = new Map(comparableClaimSets.map((candidate) => [candidate.candidateId, candidate]));
      const teacherComparable = await selectTeacherComparableCandidate(
        comparableClaimSets.filter((candidate) => candidate.sourceKind === "manual-baseline"),
        goldClaims,
        undefined,
        new Map<CoverageCacheKey, GoldCoverageSummary>()
      );
      const teacherClaims = teacherComparable?.claims ?? [];
      const judgeableCandidates = new Set(
        video.candidateReports
          .filter((candidate) => candidate.sourceKind === "manual-baseline"
            || ((candidate.sourceKind === "harness" || candidate.sourceKind === "fallback-harness")
              && (candidate.rankWithinVideo ?? Number.MAX_SAFE_INTEGER) <= shortlistPerVideo))
          .map((candidate) => candidate.candidateId)
      );

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
          judgeClients,
          options.judgeModelIds,
          options.judgeMaxTokens ?? 4000,
          logger
        );
      }
    }
    return videos;
  };

  const judgeVideoReports = async (
    videos: NarrowComparisonVideoReport[],
    harnessCells: MatrixCell[],
    includeManualBaselines: boolean
  ): Promise<void> => {
    logger.info("[stage4-start] judge");
    const comparableClaimSetIndex = buildComparableClaimSetIndex(
      harnessCells,
      fallbackCells,
      `Fallback for unavailable or degraded model rows: ${fallbackTriggeredFor.join(", ")}`
    );
    for (const video of videos) {
      const transcript = transcriptByVideo.get(video.videoId);
      const goldClaims = goldByVideo.get(video.videoId);
      if (!transcript || !goldClaims) {
        throw new Error(`Missing transcript or gold baseline for ${video.videoId}`);
      }
      const comparableClaimSets = buildComparableClaimSetsForVideo(
        video.videoId,
        comparableClaimSetIndex,
        manualByVideo,
        includeManualBaselines
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
          && (candidate.rankWithinVideo ?? Number.MAX_SAFE_INTEGER) <= shortlistPerVideo
        )
        .map((candidate) => candidate.candidateId);
      const topHarnessByRank = video.candidateReports
        .filter((candidate) =>
          (candidate.sourceKind === "harness" || candidate.sourceKind === "fallback-harness")
          && (candidate.rankWithinVideo ?? Number.MAX_SAFE_INTEGER) <= shortlistPerVideo
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
          judgeClients,
          options.judgeModelIds,
          options.judgeMaxTokens ?? 4000,
          logger
        );
      }
    }
    logger.info("[stage4-done] judge");
  };

  if (!cachedShortlist || cachedShortlist.inputSignature !== extractionStageInputSignature) {
    initialVideos = await buildVideoReports(initialHarnessCells, includeManualBaselines, false);
    if (adaptiveEscalation) {
      for (const video of initialVideos) {
        const topHarnessCandidate = video.candidateReports
          .filter((candidate) => candidate.sourceKind === "harness")
          .slice()
          .sort(compareOptimizationPriority)[0];
        if (!topHarnessCandidate?.promptConfigId) continue;
        const promptPackId = selectFastTriageEscalationPack({
          topicDomain: options.corpus.find((entry) => entry.videoId === video.videoId)?.topicDomain,
          semanticCoverage: topHarnessCandidate.semanticCoverage,
          diagnostics: topHarnessCandidate.diagnostics,
        });
        if (!promptPackId) continue;

        const targetCorpus = options.corpus.filter((entry) => entry.videoId === video.videoId);
        if (targetCorpus.length === 0) continue;
        const reason = topHarnessCandidate.diagnostics?.retryReason
          ?? (topHarnessCandidate.semanticCoverage.rootRatio === 0 ? "missing-root-claim" : "low-semantic-coverage");
        escalationReasonsByVideo[video.videoId] = [...new Set([
          ...(escalationReasonsByVideo[video.videoId] ?? []),
          reason,
          `prompt-pack:${promptPackId}`,
        ])];
        escalatedVideos.push(video.videoId);

        initialHarnessCells.push(...await runHarnessExtractionOnly(
          targetCorpus,
          options.models,
          stage1Variants,
          topHarnessCandidate.promptConfigId,
          "small-request",
          options.transcriptDir,
          options.clientFactory,
          options.maxConcurrency ?? 1,
          options.timeoutMs ?? 120_000,
          undefined,
          false,
          promptPackId,
          undefined,
          options.outputDir,
          join(options.outputDir, ".cache", "extraction"),
          logger
        ));
      }
      if (escalatedVideos.length > 0) {
        escalatedVideos = [...new Set(escalatedVideos)];
        initialVideos = await buildVideoReports(initialHarnessCells, includeManualBaselines, false);
      }
    }
    shortlistTargets = initialVideos.flatMap((video) =>
      selectShortlistCandidatesForVideo(
        video,
        shortlistPerVideo,
        adaptiveEscalation && escalatedVideos.includes(video.videoId)
      )
        .map((candidate) => ({
          videoId: video.videoId,
          modelId: candidate.modelId!,
          promptConfigId: candidate.promptConfigId!,
          chunkMode: candidate.chunkMode!,
          candidateId: candidate.candidateId,
          promptPackId: candidate.diagnostics?.promptPackId as ExtractionPromptPackId | undefined,
        }))
    );
    await writeNarrowStageArtifact<NarrowShortlistStageArtifact>(options.outputDir, "shortlist", {
      stage: "shortlist",
      mode: runMode,
      createdAt: new Date().toISOString(),
      inputSignature: extractionStageInputSignature,
      chunkModes,
      promptConfigs,
      stage1Variants,
      initialHarnessCells,
      fallbackTriggeredFor,
      fallbackCells,
      videos: initialVideos,
      shortlistTargets,
      escalatedVideos,
      escalationReasonsByVideo,
    });
    logger.info(`[stage1-done] shortlist targets=${shortlistTargets.length}`);
  }
  const teacherAwareHints = includeManualBaselines ? buildTeacherAwareHints(initialVideos) : {};
  const refinedTargets = shortlistTargets.slice(0, budgetState.remainingRefinedSelfImproveCells);
  if (shortlistTargets.length > refinedTargets.length) {
    budgetSkips.push(`refine-budget-exceeded:${shortlistTargets.length - refinedTargets.length}`);
    logger.warn(
      `[budget-skip] stage=refine skipped=${shortlistTargets.length - refinedTargets.length} remaining=${budgetState.remainingRefinedSelfImproveCells}`
    );
  }

  let refinedSelfImproveCells: MatrixCell[] = [];
  let finalHarnessCells: MatrixCell[] = [];
  const refineStageInputSignature = buildRefineStageInputSignature({
    extractionStageInputSignature,
    refinedTargets,
    teacherAwareHints,
  });
  const cachedRefine = await readNarrowStageArtifact<NarrowRefineStageArtifact>(options.outputDir, "refine");
  if (cachedRefine?.inputSignature === refineStageInputSignature) {
    logger.info("[resume-from] stage=refine");
    stageExecution.refine = "resumed";
    refinedSelfImproveCells = cachedRefine.refinedSelfImproveCells;
    finalHarnessCells = cachedRefine.finalHarnessCells;
  } else {
    logger.info("[stage2-start] refine");
    if (stage2Variants.length > 0 && refinedTargets.length > 0) {
      for (const target of refinedTargets) {
        const targetModelId = target.modelId;

        const targetCorpus = options.corpus.filter((video) => video.videoId === target.videoId);
        if (targetCorpus.length === 0) continue;
        const targetModel = options.models.find((model) => model.id === targetModelId) || getModel(targetModelId);
        if (!targetModel) continue;

        const hintKey = selfImproveHintKey(target.videoId, targetModelId, target.promptConfigId, target.chunkMode);
        const hint = teacherAwareHints[hintKey];
        const selfImproveHints = hint ? { [hintKey]: hint } : undefined;
        refinedSelfImproveCells.push(...await runHarnessExtractionOnly(
            targetCorpus,
            [targetModel],
            stage2Variants,
            target.promptConfigId,
            target.chunkMode,
            options.transcriptDir,
            options.clientFactory,
            options.maxConcurrency ?? 1,
            options.timeoutMs ?? 120_000,
            selfImproveHints,
            enablePromptRouting,
            target.promptPackId,
            "refined",
            options.outputDir,
            join(options.outputDir, ".cache", "extraction"),
            logger
          ));
      }
    }
    logger.info(`[stage2-done] refine targets=${refinedTargets.length}`);

    const shortlistedCandidateIds = new Set(shortlistTargets.map((target) => target.candidateId));
    const shortlistedHarnessCells = initialHarnessCells.filter((cell) => {
      const cid = buildComparableCandidateId(cell, "harness");
      return shortlistedCandidateIds.has(cid);
    });
    finalHarnessCells = [...shortlistedHarnessCells, ...refinedSelfImproveCells];

    await writeNarrowStageArtifact<NarrowRefineStageArtifact>(options.outputDir, "refine", {
      stage: "refine",
      mode: runMode,
      createdAt: new Date().toISOString(),
      inputSignature: refineStageInputSignature,
      stage2Variants,
      refinedTargets,
      refinedSelfImproveCells,
      finalHarnessCells,
    });
  }
  let videos: NarrowComparisonVideoReport[] = [];
  const cachedScore = await readNarrowStageArtifact<NarrowScoreStageArtifact>(options.outputDir, "score");
  if (cachedScore?.inputSignature === stageInputSignature) {
    logger.info("[resume-from] stage=score");
    stageExecution.score = "resumed";
    videos = cachedScore.videos.map((video) => backfillTranscriptStructureProfile(video, transcriptByVideo));
  } else {
    logger.info("[stage3-start] score");
    const embeddingEligibleCandidateIdsByVideo = preset.enableEmbeddings
      ? buildEmbeddingEligibleCandidateIdsByVideo({
          shortlistTargets,
          refinedSelfImproveCells,
          manualByVideo,
          includeManualBaselines,
        })
      : undefined;
    const scoredVideos: NarrowComparisonVideoReport[] = [];
    const finalComparableClaimSetIndex = buildComparableClaimSetIndex(
      finalHarnessCells,
      fallbackCells,
      `Fallback for unavailable or degraded model rows: ${fallbackTriggeredFor.join(", ")}`
    );
    for (const video of options.corpus) {
      const goldClaims = goldByVideo.get(video.videoId);
      if (!goldClaims) {
        throw new Error(`Missing gold baseline for ${video.videoId}`);
      }
      const comparableClaimSets = buildComparableClaimSetsForVideo(
        video.videoId,
        finalComparableClaimSetIndex,
        manualByVideo,
        includeManualBaselines
      );
      const videoScoreSignature = buildVideoScoreInputSignature({
        corpusSignature,
        runMode,
        videoId: video.videoId,
        includeManualBaselines,
        enableEmbeddings: preset.enableEmbeddings,
        embeddingClientAvailable,
        goldClaims,
        comparableClaimSets,
        embeddingModel: googleEmbeddingConfig.model,
        embeddingBaseUrl: googleEmbeddingConfig.baseUrl,
        embeddingBatchSize: googleEmbeddingConfig.batchSize,
        maxEmbeddingRequestsPerRun: options.maxEmbeddingRequestsPerRun,
        taskType: googleEmbeddingConfig.taskType,
        outputDimensionality: googleEmbeddingConfig.outputDimensionality,
      });
      const cachedVideoScore = await readNarrowVideoScoreArtifact(options.outputDir, video.videoId);
      if (cachedVideoScore?.inputSignature === videoScoreSignature) {
        logger.info(`[resume-from] stage=score video=${video.videoId}`);
        scoredVideos.push(backfillTranscriptStructureProfile(cachedVideoScore.video, transcriptByVideo));
        continue;
      }
      const scoredVideo = await buildSingleVideoReport(
        video,
        finalComparableClaimSetIndex,
        includeManualBaselines,
        embeddingEligibleCandidateIdsByVideo
      );
      await writeNarrowVideoScoreArtifact(options.outputDir, {
        stage: "score-video",
        mode: runMode,
        createdAt: new Date().toISOString(),
        videoId: video.videoId,
        inputSignature: videoScoreSignature,
        video: scoredVideo,
      });
      scoredVideos.push(scoredVideo);
    }
    videos = scoredVideos;
    annotateOptimizationRanks(videos);
    await writeNarrowStageArtifact<NarrowScoreStageArtifact>(options.outputDir, "score", {
      stage: "score",
      mode: runMode,
      createdAt: new Date().toISOString(),
      inputSignature: stageInputSignature,
      videos,
    });
    logger.info("[stage3-done] score");
  }
  if (judgeEnabled) {
    const cachedJudge = await readNarrowStageArtifact<NarrowJudgeStageArtifact>(options.outputDir, "judge");
    if (cachedJudge?.inputSignature === stageInputSignature) {
      logger.info("[resume-from] stage=judge");
      stageExecution.judge = "resumed";
      videos = cachedJudge.videos.map((video) => backfillTranscriptStructureProfile(video, transcriptByVideo));
    } else {
      await judgeVideoReports(videos, finalHarnessCells, includeManualBaselines);
      await writeNarrowStageArtifact<NarrowJudgeStageArtifact>(options.outputDir, "judge", {
        stage: "judge",
        mode: runMode,
        createdAt: new Date().toISOString(),
        inputSignature: stageInputSignature,
        videos,
      });
    }
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
    metadata: {
      startedAt,
      completedAt: new Date().toISOString(),
      runMode,
      judgeModelIds: judgeEnabled ? options.judgeModelIds : [],
      requestedModels: options.models.map((model) => model.id),
      chunkModes,
      promptConfigs,
      variants: [...new Set([...stage1Variants, ...stage2Variants])],
      teacherSelectionMode: "manual-baseline-best-by-gold-coverage",
      judgedTopHarnessPerVideo: shortlistPerVideo,
      fallbackModelId: options.fallbackModelId,
      fallbackTriggeredFor,
      manualBaselineDir: options.manualBaselineDir,
      transcriptDir: options.transcriptDir,
      shortlistSizePerVideo: shortlistPerVideo,
      refinedTargetCount: refinedTargets.length,
      embeddingModel: googleEmbeddingConfig.model ?? DEFAULT_GOOGLE_EMBEDDING_MODEL,
      completedStages: [
        "shortlist",
        "refine",
        "score",
        ...(judgeEnabled ? ["judge"] : []),
        "report"
      ] as NarrowStageId[],
      budgetSkips,
      stageExecution,
      judgeEnabled,
      manualBaselinesIncluded: includeManualBaselines,
      apiCallCounts: {
        apiRequests: embeddingStats.apiRequestCount,
        embeddingRequests: embeddingStats.embeddingsComputed,
        embeddingCacheHits: embeddingStats.cacheHitCount,
        embeddingCacheMisses: embeddingStats.cacheMissCount,
      },
      rateLimitStatsByModel: requestRateLimiterRegistry.getStats(),
      adaptiveEscalation,
      escalatedVideos,
      escalationReasonsByVideo,
    },
    videos,
  };
}
