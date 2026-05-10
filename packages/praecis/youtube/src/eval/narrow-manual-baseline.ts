import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ResolvedConfig } from "@aidha/config";
import type { ClaimCandidate, LlmClient } from "../extract/index.js";
import { normalizeKey } from "../extract/utils.js";
import { GoldenAnnotationEntrySchema } from "./golden-annotation-schema.js";
import { flattenGoldenClaimForest, type FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import { CorpusEntrySchema, type CorpusEntry } from "./corpus-schema.js";
import { runEvaluationMatrix, type MatrixCell, type MatrixOptions, type VideoContext } from "./matrix-runner.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import { getModel, type EvalModel } from "./model-registry.js";
import { GeminiEmbeddingClient, type GeminiEmbeddingClientConfig } from "./gemini-embedding-client.js";
import { getHostnameFromUrl, isOpenAiBaseUrl } from "../utils/urls.js";
import { requestRateLimiterRegistry } from "./request-rate-limiter.js";
import { consoleLogger, type Logger } from "../utils/logger.js";
import { getNarrowEvalChunkModes, getNarrowEvalModelProfile, type NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import { computeClaimSetHash } from "./matrix-cache.js";
import { hashId, hashFile } from "../utils/ids.js";
import { renderNarrowComparisonMarkdown } from "./narrow-report-renderer.js";
import type { NarrowDerivedJudgeScores, NarrowJudgeFindings } from "./narrow-judge.js";
import {
  PASS1_PROMPT_CONFIG_IDS,
  promptVersionForConfig,
  type Pass1PromptConfigId,
} from "../extract/prompts/pass1-claim-mining-v2.js";
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

export { computeOptimizationScore } from "./narrow-optimization-ranking.js";
export {
  assessStructuralTargets,
  profileTranscriptStructure,
  type StructuralTargetAssessment,
  type TranscriptStructureProfile,
} from "./narrow-structural-targets.js";

const ManualBaselineClaimsFileSchema = z.object({
  claims: z.array(z.object({
    text: z.string().min(1),
    type: z.string().optional(),
    confidence: z.number().optional(),
    why: z.string().optional(),
  })),
});

export const NarrowCorpusSchema = z.array(CorpusEntrySchema).min(1);

const DEFAULT_EMBEDDING_BUDGET_PER_RUN = 250;
const DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN = 4;
const DEFAULT_GOOGLE_EMBEDDING_MODEL = "gemini-embedding-001";

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

type HarnessCandidateIdSuffix = "refine";

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

interface TranscriptData {
  videoContext: VideoContext;
  fullText: string;
  structureProfile: TranscriptStructureProfile;
}

interface LoadedVideoBaselines {
  goldFlatClaims: FlattenedGoldenClaimNode[];
  comparableClaimSets: ComparableClaimSet[];
}

interface CorpusSignatureEntry {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  durationMinutes: number;
  topicDomain: string;
  expectedClaimDensity: string;
  description: string;
  language: string;
  captionSource: string;
  speakerStyle: string;
  rationale: string;
}

export function buildCorpusSignature(corpus: CorpusEntry[]): string {
  const normalizedCorpus: CorpusSignatureEntry[] = corpus
    .slice()
    .sort((a, b) => a.videoId.localeCompare(b.videoId))
    .map((entry) => ({
      videoId: entry.videoId,
      url: entry.url,
      title: entry.title,
      channelName: entry.channelName,
      durationMinutes: entry.durationMinutes,
      topicDomain: entry.topicDomain,
      expectedClaimDensity: entry.expectedClaimDensity,
      description: entry.description ?? "",
      language: entry.language ?? "",
      captionSource: entry.captionSource ?? "",
      speakerStyle: entry.speakerStyle ?? "",
      rationale: entry.rationale,
    }));

  return hashId("narrow-corpus", [JSON.stringify(normalizedCorpus)]);
}

interface NarrowModePreset {
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  stage1Variants: ExtractorVariantId[];
  stage2Variants: ExtractorVariantId[];
  shortlistPerVideo: number;
  includeManualBaselines: boolean;
  judgeEnabled: boolean;
  enableEmbeddings: boolean;
}

interface FastTriageEscalationContext {
  topicDomain?: string;
  semanticCoverage: Pick<GoldCoverageSummary, "ratio" | "rootRatio" | "childRatio">;
  diagnostics?: Pick<CandidateDiagnostics, "promptPackId" | "retryReason">;
}

const NARROW_MODE_PRESETS: Record<NarrowRunMode, NarrowModePreset> = {
  "fast-triage": {
    chunkModes: ["large-request"],
    promptConfigs: [...PASS1_PROMPT_CONFIG_IDS],
    stage1Variants: ["raw"],
    stage2Variants: ["self-improve-v1"],
    shortlistPerVideo: 1,
    includeManualBaselines: false,
    judgeEnabled: false,
    enableEmbeddings: false,
  },
  compare: {
    chunkModes: ["large-request"],
    promptConfigs: [...PASS1_PROMPT_CONFIG_IDS],
    stage1Variants: ["raw"],
    stage2Variants: ["self-improve-v1"],
    shortlistPerVideo: 1,
    includeManualBaselines: true,
    judgeEnabled: true,
    enableEmbeddings: true,
  },
  deep: {
    chunkModes: [...getNarrowEvalChunkModes()],
    promptConfigs: [...PASS1_PROMPT_CONFIG_IDS],
    stage1Variants: ["raw", "editorial-pass-v1", "self-improve-v1"],
    stage2Variants: ["self-improve-v1"],
    shortlistPerVideo: 3,
    includeManualBaselines: true,
    judgeEnabled: true,
    enableEmbeddings: true,
  },
};

function getNarrowModePreset(mode: NarrowRunMode): NarrowModePreset {
  return NARROW_MODE_PRESETS[mode];
}

function intersectVariants(requested: ExtractorVariantId[], allowed: ExtractorVariantId[]): ExtractorVariantId[] {
  const requestedSet = new Set(requested);
  return allowed.filter((variant) => requestedSet.has(variant));
}

type NarrowStageSignatureBaseInput = {
  corpusSignature: string;
  corpus: CorpusEntry[];
  modelIds: string[];
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  stage1Variants: ExtractorVariantId[];
  stage2Variants: ExtractorVariantId[];
  transcriptDir: string;
  manualBaselineDir: string;
  fallbackModelId: string;
  judgeModelIds: string[];
  judgeMaxTokens: number;
  includeManualBaselines: boolean;
  enablePromptRouting: boolean;
  maxEmbeddingRequestsPerRun?: number;
  maxRefinedSelfImproveCellsPerRun?: number;
  shortlistPerVideo?: number;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingBatchSize?: number;
  taskType?: string;
  outputDimensionality?: number;
};

type NarrowStageSignaturePayload = {
  corpusSignature: string;
  corpus: CorpusEntry[];
  modelIds: string[];
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  stage1Variants: ExtractorVariantId[];
  stage2Variants: ExtractorVariantId[];
  transcriptHash: string;
  goldHash: string;
  manualHash: string;
  includeManualBaselines: boolean;
  fallbackModelId: string;
  judgeModelIds: string[];
  judgeMaxTokens: number;
  enablePromptRouting: boolean;
  maxEmbeddingRequestsPerRun?: number;
  maxRefinedSelfImproveCellsPerRun?: number;
  shortlistPerVideo?: number;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingBatchSize?: number;
  taskType?: string;
  outputDimensionality?: number;
};

async function buildNarrowStageSignaturePayload(input: NarrowStageSignatureBaseInput): Promise<NarrowStageSignaturePayload> {
  const corpusVideoIds = input.corpus.map((video) => video.videoId);
  const transcriptFiles = corpusVideoIds.map((id) => join(input.transcriptDir, `${id}.json`));
  const transcriptHash = await hashFiles(transcriptFiles);

  const goldFiles = corpusVideoIds.map((id) => join(input.manualBaselineDir, `${id}-gold-draft-v1.json`));
  const goldHash = await hashFiles(goldFiles);

  let manualHash = "none";
  if (input.includeManualBaselines) {
    const manualFiles: string[] = [];
    for (const id of corpusVideoIds) {
      manualFiles.push(join(input.manualBaselineDir, `${id}-CG.json`));
      manualFiles.push(join(input.manualBaselineDir, `${id}-GG.json`));
    }
    manualHash = await hashFiles(manualFiles);
  }

  return {
    corpusSignature: input.corpusSignature,
    corpus: [...input.corpus].sort((a, b) => a.videoId.localeCompare(b.videoId)),
    modelIds: [...input.modelIds].sort(),
    chunkModes: [...input.chunkModes],
    promptConfigs: [...input.promptConfigs],
    stage1Variants: [...input.stage1Variants],
    stage2Variants: [...input.stage2Variants],
    transcriptHash,
    goldHash,
    manualHash,
    includeManualBaselines: input.includeManualBaselines,
    fallbackModelId: input.fallbackModelId,
    judgeModelIds: [...input.judgeModelIds].sort(),
    judgeMaxTokens: input.judgeMaxTokens,
    enablePromptRouting: input.enablePromptRouting,
    maxEmbeddingRequestsPerRun: input.maxEmbeddingRequestsPerRun,
    maxRefinedSelfImproveCellsPerRun: input.maxRefinedSelfImproveCellsPerRun,
    shortlistPerVideo: input.shortlistPerVideo,
    embeddingModel: input.embeddingModel,
    embeddingBaseUrl: input.embeddingBaseUrl,
    embeddingBatchSize: input.embeddingBatchSize,
    taskType: input.taskType,
    outputDimensionality: input.outputDimensionality,
  };
}

export async function buildStageInputSignature(input: NarrowStageSignatureBaseInput & {
  runMode: NarrowRunMode;
  judgeEnabled: boolean;
  embeddingClientAvailable: boolean;
}): Promise<string> {
  const payload = await buildNarrowStageSignaturePayload(input);

  return hashId("narrow-stage", [JSON.stringify({
    corpusSignature: payload.corpusSignature,
    runMode: input.runMode,
    corpus: payload.corpus,
    modelIds: payload.modelIds,
    chunkModes: payload.chunkModes,
    promptConfigs: payload.promptConfigs,
    stage1Variants: payload.stage1Variants,
    stage2Variants: payload.stage2Variants,
    transcriptHash: payload.transcriptHash,
    goldHash: payload.goldHash,
    manualHash: payload.manualHash,
    fallbackModelId: payload.fallbackModelId,
    judgeEnabled: input.judgeEnabled,
    judgeModelIds: payload.judgeModelIds,
    judgeMaxTokens: payload.judgeMaxTokens,
    includeManualBaselines: payload.includeManualBaselines,
    enablePromptRouting: payload.enablePromptRouting,
    maxEmbeddingRequestsPerRun: payload.maxEmbeddingRequestsPerRun,
    maxRefinedSelfImproveCellsPerRun: payload.maxRefinedSelfImproveCellsPerRun,
    shortlistPerVideo: payload.shortlistPerVideo,
    embeddingClientAvailable: input.embeddingClientAvailable,
    embeddingModel: payload.embeddingModel,
    embeddingBaseUrl: payload.embeddingBaseUrl,
    embeddingBatchSize: payload.embeddingBatchSize,
    taskType: payload.taskType,
    outputDimensionality: payload.outputDimensionality,
  })]);
}

async function hashFiles(filePaths: string[]): Promise<string> {
  const hashes = await Promise.all(filePaths.map((p) => hashFile(p)));
  return hashId("files", hashes.filter(Boolean) as string[]);
}

export async function buildExtractionStageInputSignature(input: NarrowStageSignatureBaseInput): Promise<string> {
  const payload = await buildNarrowStageSignaturePayload(input);

  return hashId("narrow-extraction-stage", [JSON.stringify({
    corpusSignature: payload.corpusSignature,
    corpus: payload.corpus,
    modelIds: payload.modelIds,
    chunkModes: payload.chunkModes,
    promptConfigs: payload.promptConfigs,
    stage1Variants: payload.stage1Variants,
    stage2Variants: payload.stage2Variants,
    transcriptHash: payload.transcriptHash,
    goldHash: payload.goldHash,
    manualHash: payload.manualHash,
    includeManualBaselines: payload.includeManualBaselines,
    manualBaselineDir: input.manualBaselineDir,
    fallbackModelId: payload.fallbackModelId,
    judgeModelIds: payload.judgeModelIds,
    judgeMaxTokens: payload.judgeMaxTokens,
    enablePromptRouting: payload.enablePromptRouting,
    maxEmbeddingRequestsPerRun: payload.maxEmbeddingRequestsPerRun,
    maxRefinedSelfImproveCellsPerRun: payload.maxRefinedSelfImproveCellsPerRun,
    shortlistPerVideo: payload.shortlistPerVideo,
    embeddingModel: payload.embeddingModel,
    embeddingBaseUrl: payload.embeddingBaseUrl,
    embeddingBatchSize: payload.embeddingBatchSize,
    taskType: payload.taskType,
    outputDimensionality: payload.outputDimensionality,
  })]);
}

export function shouldFastTriageEscalate(input: {
  semanticCoverage: Pick<GoldCoverageSummary, "ratio" | "rootRatio" | "childRatio">;
  diagnostics?: Pick<CandidateDiagnostics, "promptPackId" | "retryReason">;
}): boolean {
  if (input.semanticCoverage.rootRatio === 0) return true;
  if (input.semanticCoverage.ratio < 0.25) return true;
  if (input.diagnostics?.retryReason === "missing-root-claim") return true;
  const enumerationLikePack = input.diagnostics?.promptPackId === "enumeration-framework"
    || input.diagnostics?.promptPackId === "business-framework"
    || input.diagnostics?.promptPackId === "generic-hierarchy";
  return enumerationLikePack && input.semanticCoverage.childRatio >= Math.max(0.4, input.semanticCoverage.rootRatio + 0.35);
}

export function selectFastTriageEscalationPack(input: FastTriageEscalationContext): ExtractionPromptPackId | undefined {
  if (!shouldFastTriageEscalate(input)) return undefined;
  const normalizedDomain = input.topicDomain?.toLowerCase() ?? "";
  const currentPack = input.diagnostics?.promptPackId;
  if (
    currentPack === "clinical-risk-management"
    || currentPack === "clinical-risk-management-v2"
    || /(clinical|medical|cardio|lipid|health|medicine|biology)/.test(normalizedDomain)
  ) {
    return "clinical-risk-management-v2";
  }
  return "enumeration-framework-v2";
}

function isAdaptiveEscalationCandidate(candidate: NarrowComparisonCandidateReport): boolean {
  return candidate.chunkMode === "small-request"
    && (candidate.diagnostics?.promptPackId?.endsWith("-v2") ?? false);
}

export function selectShortlistCandidatesForVideo(
  video: NarrowComparisonVideoReport,
  shortlistPerVideo: number,
  preferAdaptiveEscalation: boolean
): NarrowComparisonCandidateReport[] {
  const harnessCandidates = video.candidateReports.filter((candidate) =>
    candidate.sourceKind === "harness"
      && candidate.promptConfigId
      && candidate.chunkMode
  );
  const bestSemanticRatio = harnessCandidates.reduce(
    (best, candidate) => Math.max(best, candidate.semanticCoverage.ratio),
    0
  );
  const gatedHarnessCandidates = harnessCandidates.filter((candidate) =>
    candidate.structuralTargetAssessment?.passesShortlistGate
      && candidate.semanticCoverage.ratio >= Math.max(bestSemanticRatio - 0.1, bestSemanticRatio * 0.75)
  );
  const shortlistPool = gatedHarnessCandidates.length > 0 ? gatedHarnessCandidates : harnessCandidates;
  if (!preferAdaptiveEscalation) {
    return shortlistPool
      .slice()
      .sort(compareOptimizationPriority)
      .slice(0, shortlistPerVideo);
  }

  const escalated = shortlistPool.filter(isAdaptiveEscalationCandidate);
  if (escalated.length > 0) {
    return escalated
      .slice()
      .sort(compareOptimizationPriority)
      .slice(0, shortlistPerVideo);
  }

  return shortlistPool
    .slice()
    .sort(compareOptimizationPriority)
    .slice(0, shortlistPerVideo);
}

export function buildVideoScoreInputSignature(input: {
  corpusSignature: string;
  runMode: NarrowRunMode;
  videoId: string;
  includeManualBaselines: boolean;
  enableEmbeddings: boolean;
  embeddingClientAvailable: boolean;
  goldClaims: FlattenedGoldenClaimNode[];
  comparableClaimSets: ComparableClaimSet[];
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingBatchSize?: number;
  maxEmbeddingRequestsPerRun?: number;
  taskType?: string;
  outputDimensionality?: number;
}): string {
  return hashId("narrow-video-score", [JSON.stringify({
    corpusSignature: input.corpusSignature,
    runMode: input.runMode,
    videoId: input.videoId,
    includeManualBaselines: input.includeManualBaselines,
    enableEmbeddings: input.enableEmbeddings,
    embeddingClientAvailable: input.embeddingClientAvailable,
    embeddingModel: input.embeddingModel,
    embeddingBaseUrl: input.embeddingBaseUrl,
    embeddingBatchSize: input.embeddingBatchSize,
    maxEmbeddingRequestsPerRun: input.maxEmbeddingRequestsPerRun,
    taskType: input.taskType,
    outputDimensionality: input.outputDimensionality,
    goldClaims: input.goldClaims.map((claim) => ({ id: claim.id, depth: claim.depth, text: normalizeKey(claim.text) })),
    candidates: input.comparableClaimSets.map((candidate) => ({
      candidateId: candidate.candidateId,
      sourceKind: candidate.sourceKind,
      claimSetHash: computeClaimSetHash(candidate.claims),
    })),
  })]);
}

function isModelUnavailableError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("404")
    || normalized.includes("not found")
    || normalized.includes("unknown model")
    || normalized.includes("unsupported model")
    || normalized.includes("does not exist")
    || normalized.includes("invalid model");
}

function isRateLimitOrQuotaError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("429")
    || normalized.includes("quota exceeded")
    || normalized.includes("rate limit")
    || normalized.includes("billing details")
    || normalized.includes("resource exhausted")
    || normalized.includes("high demand")
    || normalized.includes("503");
}

function isFallbackOnlyCell(cell: MatrixCell): boolean {
  return cell.claimSet.length > 0 && cell.claimSet.every((claim) => claim.method === "heuristic-fallback");
}

function countFallbackClaims(cell: MatrixCell): number {
  return cell.claimSet.filter((claim) => claim.method === "heuristic-fallback").length;
}

function deriveTimeoutSource(cell: MatrixCell): TimeoutSource {
  if ((cell.extractionDiagnostics?.clientTimeoutCount ?? 0) > 0) return "llm_client_timeout";
  if (cell.error?.message?.toLowerCase().includes("extraction timeout")) return "matrix_cell_timeout";
  if ((cell.extractionDiagnostics?.upstreamAbortCount ?? 0) > 0) return "upstream_abort";
  return "none";
}

function deriveFallbackKind(cell: MatrixCell): FallbackKind {
  const fallbackClaims = countFallbackClaims(cell);
  if (fallbackClaims === 0) return "none";
  if (fallbackClaims === cell.claimSet.length) return "full";
  return "partial";
}

export function needsFallbackForModel(cells: MatrixCell[], modelId: string): boolean {
  const modelCells = cells.filter((cell) => cell.modelId === modelId);
  return modelCells.length > 0 && modelCells.every((cell) =>
    isModelUnavailableError(cell.error?.message)
      || isRateLimitOrQuotaError(cell.error?.message)
      || isFallbackOnlyCell(cell)
  );
}

function buildDiagnostics(cell: MatrixCell): CandidateDiagnostics {
  return {
    timeoutSource: deriveTimeoutSource(cell),
    retryCount: cell.extractionDiagnostics?.transportRetryCount ?? 0,
    fallbackKind: deriveFallbackKind(cell),
    transientFailureCount: cell.extractionDiagnostics?.transientFailureCount ?? 0,
    clientTimeoutCount: cell.extractionDiagnostics?.clientTimeoutCount ?? 0,
    upstreamAbortCount: cell.extractionDiagnostics?.upstreamAbortCount ?? 0,
    maxChunkInputTokens: cell.extractionDiagnostics?.maxChunkInputTokens ?? 0,
    chunkInputTokenCounts: cell.extractionDiagnostics?.chunkInputTokenCounts ?? [],
    selfImproveRoundCount: cell.extractionDiagnostics?.selfImproveRoundCount ?? 0,
    promptPackId: cell.extractionDiagnostics?.promptPackId,
    routeSource: cell.extractionDiagnostics?.routeSource,
    routeConfidence: cell.extractionDiagnostics?.routeConfidence,
    routeSignals: cell.extractionDiagnostics?.routeSignals ?? [],
    retryTriggered: cell.extractionDiagnostics?.retryTriggered,
    retryReason: cell.extractionDiagnostics?.retryReason,
    retryPromptPackId: cell.extractionDiagnostics?.retryPromptPackId,
  };
}

export function buildComparableCandidateId(
  cell: Pick<MatrixCell, "modelId" | "extractorVariantId" | "promptConfigId" | "chunkMode" | "extractionDiagnostics" | "refinementStage">,
  sourceKind: ComparableSourceKind,
  suffix?: HarnessCandidateIdSuffix
): string {
  const baseId = `${sourceKind === "manual-baseline" ? "manual" : sourceKind}/${cell.modelId}/${cell.extractorVariantId}${cell.promptConfigId ? `/${cell.promptConfigId}` : ""}${cell.chunkMode ? `/${cell.chunkMode}` : ""}${cell.extractionDiagnostics?.promptPackId ? `/${cell.extractionDiagnostics.promptPackId}` : ""}`;
  const effectiveSuffix = suffix ?? (sourceKind === "harness" && cell.refinementStage === "refined" ? "refine" : undefined);
  return effectiveSuffix ? `${baseId}/${effectiveSuffix}` : baseId;
}

function toHarnessComparableClaimSet(
  cell: MatrixCell,
  sourceKind: ComparableSourceKind,
  note?: string,
  candidateIdSuffix?: HarnessCandidateIdSuffix
): ComparableClaimSet {
  const diagnostics = buildDiagnostics(cell);
  const fallbackClaimCount = countFallbackClaims(cell);
  const noteParts = [
    note,
    diagnostics.timeoutSource === "llm_client_timeout" ? "LLM request timed out at the client layer" : undefined,
    diagnostics.timeoutSource === "matrix_cell_timeout" ? "Matrix cell timeout fired" : undefined,
    diagnostics.timeoutSource === "upstream_abort" ? "LLM request was aborted by upstream timeout/cancellation" : undefined,
    diagnostics.fallbackKind === "full" ? "LLM extraction fell back to heuristic claims for all extracted claims" : undefined,
    diagnostics.fallbackKind === "partial" ? `Some extracted claims came from heuristic fallback (${fallbackClaimCount})` : undefined,
    isRateLimitOrQuotaError(cell.error?.message) ? "Provider request was rate-limited or unavailable" : undefined,
    diagnostics.retryCount > 0 ? `Transport retry recovered after ${diagnostics.retryCount} retry attempt(s)` : undefined,
    diagnostics.transientFailureCount > 0 ? `Transient provider errors observed (${diagnostics.transientFailureCount})` : undefined,
    diagnostics.selfImproveRoundCount > 0 ? `Self-improvement rounds: ${diagnostics.selfImproveRoundCount}` : undefined,
    diagnostics.promptPackId ? `Prompt pack: ${diagnostics.promptPackId}` : undefined,
    diagnostics.retryTriggered ? `Prompt retry: ${diagnostics.retryReason ?? "retry-triggered"} -> ${diagnostics.retryPromptPackId ?? "unknown"}` : undefined,
    diagnostics.maxChunkInputTokens > 0 ? `Max chunk input tokens: ${diagnostics.maxChunkInputTokens}` : undefined,
  ].filter(Boolean);

  return {
    videoId: cell.videoId,
    candidateId: buildComparableCandidateId(cell, sourceKind, candidateIdSuffix),
    sourceKind,

    claims: cell.claimSet,
    modelId: cell.modelId,
    variantId: cell.extractorVariantId,
    chunkMode: cell.chunkMode as NarrowEvalChunkMode | undefined,
    promptConfigId: cell.promptConfigId as Pass1PromptConfigId | undefined,
    note: noteParts.length > 0 ? noteParts.join(" - ") : undefined,
    error: cell.error?.message ?? (diagnostics.fallbackKind === "full" ? "LLM extraction degraded to heuristic fallback" : undefined),
    diagnostics,
  };
}

export function buildHarnessComparableClaimSet(
  cell: MatrixCell,
  note?: string
): ComparableClaimSet {
  return toHarnessComparableClaimSet(
    cell,
    "harness",
    note,
    cell.refinementStage === "refined" ? "refine" : undefined
  );
}

function toManualComparableClaimSet(videoId: string, baselineId: string, claims: ClaimCandidate[]): ComparableClaimSet {
  return {
    videoId,
    candidateId: `manual/${baselineId}`,
    sourceKind: "manual-baseline",
    claims,
    note: `Loaded from ${videoId}-${baselineId}.json`,
    diagnostics: {
      timeoutSource: "none",
      retryCount: 0,
      fallbackKind: "none",
      transientFailureCount: 0,
      clientTimeoutCount: 0,
      upstreamAbortCount: 0,
      maxChunkInputTokens: 0,
      chunkInputTokenCounts: [],
      selfImproveRoundCount: 0,
    },
  };
}

async function readJsonFile<T>(path: string, schema: z.ZodSchema<T>): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return schema.parse(JSON.parse(raw));
}

async function loadTranscript(video: CorpusEntry, transcriptDir: string): Promise<TranscriptData> {
  const transcript = await readJsonFile(
    join(transcriptDir, `${video.videoId}.json`),
    z.object({
      videoId: z.string(),
      language: z.string().optional(),
      fullText: z.string(),
      segments: z.array(z.object({
        start: z.number(),
        duration: z.number(),
        text: z.string(),
      })),
    })
  );

  return {
    videoContext: {
      videoId: video.videoId,
      title: video.title,
      channelName: video.channelName,
      description: video.description,
      url: video.url,
      durationMinutes: video.durationMinutes,
      topicDomain: video.topicDomain,
    },
    fullText: transcript.fullText,
    structureProfile: profileTranscriptStructure(transcript.fullText),
  };
}

async function loadVideoBaselines(
  videoId: string,
  manualBaselineDir: string,
  options: { includeManualBaselines?: boolean } = {}
): Promise<LoadedVideoBaselines> {
  const goldEntry = await readJsonFile(
    join(manualBaselineDir, `${videoId}-gold-draft-v1.json`),
    GoldenAnnotationEntrySchema
  );

  const goldFlatClaims = flattenGoldenClaimForest(videoId, goldEntry.idealClaims);
  const comparableClaimSets: ComparableClaimSet[] = [];

  if (options.includeManualBaselines) {
    const baselineIds = ["CG", "GG"] as const;
    for (const baselineId of baselineIds) {
      const baseline = await readJsonFile(
        join(manualBaselineDir, `${videoId}-${baselineId}.json`),
        ManualBaselineClaimsFileSchema
      );
      const claims: ClaimCandidate[] = baseline.claims.map((claim, index) => ({
        text: claim.text,
        excerptIds: [`manual-${baselineId.toLowerCase()}-${index}`],
        type: claim.type?.toLowerCase(),
        confidence: claim.confidence,
        why: claim.why,
        method: "llm",
        state: "accepted",
      }));
      comparableClaimSets.push(toManualComparableClaimSet(videoId, baselineId, claims));
    }
  }

  return { goldFlatClaims, comparableClaimSets };
}

function getGoogleEmbeddingConfig(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv = process.env
): {
  apiKey?: string;
  baseUrl: string;
  model?: string;
  batchSize?: number;
  taskType?: GeminiEmbeddingClientConfig["taskType"];
  outputDimensionality?: number;
} {
  const llm = config.llm;
  const isGeminiModel = llm.model?.toLowerCase().startsWith("gemini-");
  const isOpenAiDefault = isOpenAiBaseUrl(llm.baseUrl);

  return {
    apiKey:
      env["GOOGLE_AISTUDIO_API_KEY"] ||
      env["GEMINI_API_KEY"] ||
      env["GOOGLE_API_KEY"] ||
      env["AIDHA_GOOGLE_API_KEY"] ||
      ((isGeminiModel || llm.apiKey?.startsWith("AIza")) ? llm.apiKey : ""),
    baseUrl:
      env["GOOGLE_EMBEDDING_BASE_URL"] ||
      (isGeminiModel
        ? (isOpenAiDefault
          ? "https://generativelanguage.googleapis.com/v1beta"
          : llm.baseUrl.replace(/\/openai\/?$/, ""))
        : "https://generativelanguage.googleapis.com/v1beta"),
    model:
      env["GOOGLE_EMBEDDING_MODEL"] ||
      env["AIDHA_GOOGLE_EMBEDDING_MODEL"] ||
      env["AIDHA_EVAL_EMBEDDING_MODEL"] ||
      DEFAULT_GOOGLE_EMBEDDING_MODEL,
    batchSize: llm.embeddingBatchSize,
    taskType: (env["GOOGLE_EMBEDDING_TASK_TYPE"] || llm.embeddingTaskType || "SEMANTIC_SIMILARITY") as GeminiEmbeddingClientConfig["taskType"],
    outputDimensionality: Number(env["GOOGLE_EMBEDDING_OUTPUT_DIMENSIONALITY"]) || llm.embeddingOutputDimensionality || 768,
  };
}


interface ComparableClaimSetIndex {
  harnessByVideoId: Map<string, ComparableClaimSet[]>;
  fallbackByVideoId: Map<string, ComparableClaimSet[]>;
}

function appendComparableClaimSet(
  index: Map<string, ComparableClaimSet[]>,
  candidate: ComparableClaimSet
): void {
  const candidates = index.get(candidate.videoId) ?? [];
  candidates.push(candidate);
  index.set(candidate.videoId, candidates);
}

function buildComparableClaimSetIndex(
  harnessCells: MatrixCell[],
  fallbackCells: MatrixCell[],
  fallbackNote: string
): ComparableClaimSetIndex {
  const harnessByVideoId = new Map<string, ComparableClaimSet[]>();
  const fallbackByVideoId = new Map<string, ComparableClaimSet[]>();

  for (const cell of harnessCells) {
    appendComparableClaimSet(harnessByVideoId, buildHarnessComparableClaimSet(cell));
  }
  for (const cell of fallbackCells) {
    appendComparableClaimSet(
      fallbackByVideoId,
      toHarnessComparableClaimSet(cell, "fallback-harness", fallbackNote)
    );
  }

  return { harnessByVideoId, fallbackByVideoId };
}

function buildComparableClaimSetsForVideo(
  videoId: string,
  index: ComparableClaimSetIndex,
  manualByVideo: Map<string, ComparableClaimSet[]>,
  includeManualBaselines: boolean
): ComparableClaimSet[] {
  return [
    ...(index.harnessByVideoId.get(videoId) ?? []),
    ...(includeManualBaselines ? (manualByVideo.get(videoId) ?? []) : []),
    ...(index.fallbackByVideoId.get(videoId) ?? []),
  ];
}

function backfillTranscriptStructureProfile(
  video: NarrowComparisonVideoReport,
  transcriptByVideo: Map<string, TranscriptData>
): NarrowComparisonVideoReport {
  if (video.transcriptStructureProfile) {
    return video;
  }
  const transcript = transcriptByVideo.get(video.videoId);
  return {
    ...video,
    transcriptStructureProfile: {
      tags: [...(transcript?.structureProfile.tags ?? [])],
      cueMatches: [...(transcript?.structureProfile.cueMatches ?? [])],
    },
  };
}

async function buildCandidateReport(
  candidate: ComparableClaimSet,
  goldClaims: FlattenedGoldenClaimNode[],
  transcriptProfile: TranscriptStructureProfile,
  embeddingClient?: GeminiEmbeddingClient,
  coverageCache?: Map<CoverageCacheKey, GoldCoverageSummary>,
  budgetState?: EmbeddingBudgetState
): Promise<NarrowComparisonCandidateReport> {
  const structuralTargetAssessment = assessStructuralTargets(candidate.claims, transcriptProfile);
  const strictCoverage = await computeCoverageByMode(candidate.claims, goldClaims, "strict", undefined, coverageCache);
  const semanticCoverage = await computeCoverageByMode(candidate.claims, goldClaims, "semantic", embeddingClient, coverageCache, budgetState);
  const embeddingCoverage = embeddingClient
    ? await computeCoverageByMode(candidate.claims, goldClaims, "embedding", embeddingClient, coverageCache, budgetState)
    : undefined;

  if (candidate.error) {
    return {
      candidateId: candidate.candidateId,
      sourceKind: candidate.sourceKind,
      modelId: candidate.modelId,
      variantId: candidate.variantId,
      chunkMode: candidate.chunkMode,
      promptConfigId: candidate.promptConfigId,
      note: candidate.note,
      claimCount: candidate.claims.length,
      structuralTargetScore: structuralTargetAssessment.score,
      structuralTargetAssessment,
      strictCoverage,
      semanticCoverage,
      embeddingCoverage,
      goldCoverage: semanticCoverage,
      diagnostics: candidate.diagnostics,
      error: candidate.error,
    };
  }

  if (candidate.claims.length === 0) {
    return {
      candidateId: candidate.candidateId,
      sourceKind: candidate.sourceKind,
      modelId: candidate.modelId,
      variantId: candidate.variantId,
      chunkMode: candidate.chunkMode,
      promptConfigId: candidate.promptConfigId,
      note: [candidate.note, "No claims extracted; judge skipped"].filter(Boolean).join(" - ") || undefined,
      claimCount: 0,
      structuralTargetScore: 0,
      structuralTargetAssessment,
      strictCoverage,
      semanticCoverage,
      embeddingCoverage,
      goldCoverage: semanticCoverage,
      diagnostics: candidate.diagnostics,
    };
  }

  return {
    candidateId: candidate.candidateId,
    sourceKind: candidate.sourceKind,
    modelId: candidate.modelId,
    variantId: candidate.variantId,
    chunkMode: candidate.chunkMode,
    promptConfigId: candidate.promptConfigId,
    note: candidate.note,
    claimCount: candidate.claims.length,
    structuralTargetScore: structuralTargetAssessment.score,
    structuralTargetAssessment,
    strictCoverage,
    semanticCoverage,
    embeddingCoverage,
    goldCoverage: semanticCoverage,
    diagnostics: candidate.diagnostics,
  };
}

async function runHarnessExtractionOnly(
  corpus: CorpusEntry[],
  models: EvalModel[],
  variants: ExtractorVariantId[],
  promptConfigId: Pass1PromptConfigId,
  chunkMode: NarrowEvalChunkMode,
  transcriptDir: string,
  clientFactory: (modelId: string) => LlmClient,
  maxConcurrency: number,
  timeoutMs: number,
  selfImproveHints?: Record<string, SelfImproveHintInput>,
  enablePromptRouting: boolean = true,
  promptPackId?: ExtractionPromptPackId,
  refinementStage?: "refined",
  outputDir?: string,
  cacheDir?: string,
  logger?: Logger
): Promise<MatrixCell[]> {
  const chunkProfiles = Object.fromEntries(models.map((model) => {
    const profile = getNarrowEvalModelProfile(model.id, chunkMode);
    return [model.id, {
      chunkStrategy: profile.chunkStrategy,
      targetInputTokens: profile.targetInputTokens,
      hardMaxInputTokens: profile.hardMaxInputTokens,
      overlapExcerpts: profile.overlapExcerpts,
    }];
  }));

  const firstModelId = models[0]?.id ?? "gemini-3.1-flash-lite-preview";
  const firstProfile = chunkProfiles[firstModelId] ?? getNarrowEvalModelProfile(firstModelId, chunkMode);

  const options: MatrixOptions = {
    outputDir: outputDir ?? "out/eval-matrix/reports/narrow-manual-baseline",
    cacheDir: cacheDir ?? ".cache/extraction/narrow-manual-baseline-optimizer",
    transcriptDir,
    resume: false,
    dryRun: false,
    variants,
    judgeModels: [],
    maxConcurrency,
    timeoutMs,
    extractionChunkStrategy: firstProfile.chunkStrategy,
    extractionChunkTargetInputTokens: firstProfile.targetInputTokens,
    extractionChunkHardMaxInputTokens: firstProfile.hardMaxInputTokens,
    extractionChunkOverlapExcerpts: firstProfile.overlapExcerpts,
    extractionChunkProfiles: chunkProfiles,
    extractionChunkModeId: chunkMode,
    extractionTransportRetryMaxAttempts: 3,
    extractionTransportRetryBaseDelayMs: 750,
    extractionSelfImproveHints: selfImproveHints,
    extractionEnablePromptRouting: enablePromptRouting,
    extractionPromptPackId: promptPackId,
    extractionPromptVersion: promptVersionForConfig(promptConfigId, promptPackId),
    extractionPromptConfigId: promptConfigId,
    cellLabelPrefix: `mode=${chunkMode} prompt=${promptConfigId}`,
    logger,
    extractorClientFactory: clientFactory,
    judgeClientFactory: () => {
      throw new Error("Judge client should not be used during extraction-only run");
    },
  };

  const result = await runEvaluationMatrix(corpus, models, options);
  return result.cells.map((cell) => ({ ...cell, chunkMode, promptConfigId, refinementStage }));
}

function buildRefineStageInputSignature(input: {
  extractionStageInputSignature: string;
  refinedTargets: NarrowShortlistTarget[];
  teacherAwareHints: Record<string, SelfImproveHintInput>;
}): string {
  return hashId("narrow-refine-stage", [
    input.extractionStageInputSignature,
    JSON.stringify({
      refinedTargets: input.refinedTargets,
      teacherAwareHints: input.teacherAwareHints,
    }),
  ]);
}

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
    ? new GeminiEmbeddingClient({
        apiKey: googleEmbeddingConfig.apiKey!,
        baseUrl: googleEmbeddingConfig.baseUrl,
        cacheDir: join(options.outputDir, ".cache", "eval-embeddings"),
        timeoutMs: options.timeoutMs ?? 120_000,
        model: googleEmbeddingConfig.model,
        batchSize: googleEmbeddingConfig.batchSize,
        taskType: googleEmbeddingConfig.taskType,
        outputDimensionality: googleEmbeddingConfig.outputDimensionality,
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
    const embeddingEligibleCandidateIdsByVideo = new Map<string, Set<string>>();
    if (preset.enableEmbeddings) {
      for (const target of shortlistTargets) {
        const set = embeddingEligibleCandidateIdsByVideo.get(target.videoId) ?? new Set<string>();
        set.add(target.candidateId);
        embeddingEligibleCandidateIdsByVideo.set(target.videoId, set);
      }
      for (const cell of refinedSelfImproveCells) {
        const set = embeddingEligibleCandidateIdsByVideo.get(cell.videoId) ?? new Set<string>();
        set.add(buildComparableCandidateId(cell, "harness"));
        embeddingEligibleCandidateIdsByVideo.set(cell.videoId, set);
      }
      if (includeManualBaselines) {
        for (const [videoId, manualCandidates] of manualByVideo.entries()) {
          const set = embeddingEligibleCandidateIdsByVideo.get(videoId) ?? new Set<string>();
          for (const candidate of manualCandidates) set.add(candidate.candidateId);
          embeddingEligibleCandidateIdsByVideo.set(videoId, set);
        }
      }
    }
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
        preset.enableEmbeddings ? embeddingEligibleCandidateIdsByVideo : undefined
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
