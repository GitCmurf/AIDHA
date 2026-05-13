import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_GRAPH_SCHEMA_VERSION, type GraphNode } from "@aidha/graph-backend";
import { Transcript } from "../schema/transcript.js";
import type { ClaimCandidate } from "../extract/types.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { ClaimSetScore } from "./scoring-rubric.js";
import type { CorpusEntry } from "./corpus-schema.js";
import { getModel, type EvalModel } from "./model-registry.js";
import { estimateTokens, estimateCost } from "../extract/token-budget.js";
import { formatErrorRecord } from "../extract/utils.js";
import {
  getCachedExtraction,
  setCachedExtraction,
  getCachedScore,
  setCachedScore,
  computeClaimSetHash,
} from "./matrix-cache.js";
import { scoreClaimSet } from "./scoring-executor.js";
import { computeConsensus } from "./consensus-scorer.js";
import { LlmClaimExtractor } from "../extract/llm-claims.js";
import type { LlmClient, LlmTokenUsage } from "../extract/llm-client.js";
import {
  PROMPT_VERSION as EXTRACT_PROMPT_VERSION,
  type Pass1PromptConfigId,
} from "../extract/prompts/pass1-claim-mining-v2.js";
import { JUDGE_PROMPT_VERSION } from "./prompts/judge-claim-quality.js";
import { isValidSafeId } from "../utils/ids.js";
import { decidePromptPack, type ExtractionPromptPackId, type PromptRoutingDecision } from "../extract/prompt-routing.js";
import type { NarrowJudgeResult } from "./narrow-judge.js";
import { consoleLogger, type Logger } from "../utils/logger.js";

export const EXTRACTOR_VERSION = "v1";

// Log prefixes for consistent formatting
const LOG_PREFIX_PARTIAL_SCORING = "[partial-scoring]";

function buildSelfImproveHintKey(
  videoId: string,
  variant: ExtractorVariantId,
  modelId: string,
  promptConfigId?: string,
  chunkModeId?: string
): string {
  return [videoId, variant, modelId, promptConfigId ?? "baseline", chunkModeId ?? "default"].join("|");
}

export interface VideoContext {
  videoId: string;
  title: string;
  channelName: string;
  description?: string;
  url?: string;
  durationMinutes?: number;
  topicDomain?: string;
}

export interface MatrixOptions {
  outputDir: string;
  cacheDir: string;
  transcriptDir: string;
  resume: boolean;
  dryRun: boolean;
  runId?: string;
  variants: ExtractorVariantId[];
  judgeModels: string[];
  maxConcurrency: number;
  timeoutMs: number;
  extractionMaxTokens?: number;
  extractionMaxChunks?: number;
  extractionChunkStrategy?: 'time' | 'semantic-overlap' | 'whole-transcript';
  extractionChunkTargetInputTokens?: number;
  extractionChunkHardMaxInputTokens?: number;
  extractionChunkOverlapExcerpts?: number;
  extractionChunkProfiles?: Record<string, {
    chunkStrategy?: 'time' | 'semantic-overlap' | 'whole-transcript';
    targetInputTokens?: number;
    hardMaxInputTokens?: number;
    overlapExcerpts?: number;
  }>;
  extractionSelfImproveMaxRounds?: number;
  extractionTransportRetryMaxAttempts?: number;
  extractionTransportRetryBaseDelayMs?: number;
  extractionChunkModeId?: string;
  extractionSelfImproveHints?: Record<string, {
    teacherCandidateId?: string;
    focusAreas?: string[];
    missingTeacherClaims?: string[];
    extraCandidateClaims?: string[];
  }>;
  extractionEnablePromptRouting?: boolean;
  extractionPromptPackId?: ExtractionPromptPackId;
  extractionPromptVersion?: string;
  extractionPromptConfigId?: Pass1PromptConfigId;
  cellLabelPrefix?: string;
  judgeMaxTokens?: number;
  logger?: Logger;
  extractorClientFactory: (modelId: string) => LlmClient;
  judgeClientFactory: (modelId: string) => LlmClient;
}

export type ScoreDimension =
  | "completeness"
  | "accuracy"
  | "topicCoverage"
  | "atomicity"
  | "overallScore";

export interface MatrixCell {
  videoId: string;
  modelId: string;
  extractorVariantId: ExtractorVariantId;
  refinementStage?: "refined";
  chunkMode?: string;
  promptConfigId?: string;
  claimSet: ClaimCandidate[];
  scores?: ClaimSetScore[];
  consensusScore?: {
    mean: ClaimSetScore;
    variance: Partial<Record<ScoreDimension, number>>;
    isHighVariance: boolean;
  };
  narrowJudgeResult?: NarrowJudgeResult;
  error?: { message: string; code?: string; details?: Record<string, string> };
  costEstimate?: {
    extractionUsd: number;
    judgeUsd: number;
    totalUsd: number;
  };
  usage?: {
    extraction?: UsageProjection;
    judge?: UsageProjection;
    availability: "estimated-only" | "partial-actual" | "complete-actual";
  };
  traces?: {
    extraction?: { prompt: { system: string; user: string }; response: string }[];
    scoring?: Record<string, { prompt: { system: string; user: string }; response: string }[]>;
  };
  warnings?: string[];
  extractionDiagnostics?: {
    transportRetryCount: number;
    fallbackChunkCount: number;
    transientFailureCount: number;
    clientTimeoutCount: number;
    upstreamAbortCount: number;
    chunkInputTokenCounts: number[];
    maxChunkInputTokens: number;
    selfImproveRoundCount: number;
    promptPackId: string;
    routeSource: string;
    routeConfidence: number;
    routeSignals: string[];
    retryTriggered: boolean;
    retryReason?: string;
    retryPromptPackId?: string;
  };
}

export interface UsageProjection {
  estimated: LlmTokenUsage;
  actual?: LlmTokenUsage;
  estimatedCostUsd: number;
  actualCostUsd?: number;
}

export interface MatrixResult {
  cells: MatrixCell[];
  metadata: {
    startedAt: string;
    completedAt?: string;
    runId?: string;
    config: Record<string, unknown>; // Serializable config
    failedCellCount: number;
    partialFailureCount: number;
  };
}

class Semaphore {
  private count: number;
  private waiting: (() => void)[] = [];

  constructor(count: number) {
    this.count = Math.max(1, count);
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    this.count++;
    const next = this.waiting.shift();
    if (next) {
      this.count--;
      next();
    }
  }
}

const withRequestBudget = async <T>(
  requestSemaphore: Semaphore,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  await requestSemaphore.acquire();
  // Start the per-request timeout only after the shared slot is acquired so
  // queueing time does not eat into the request's own LLM budget.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    requestSemaphore.release();
  }
};

const JUDGE_PROMPT_OVERHEAD_TOKENS = 1000;
const JUDGE_OUTPUT_TOKENS_ESTIMATE = 200;
/**
 * Estimated claim text length (in characters) for dry-run cost projections.
 * These values approximate the total claim text length based on expectedClaimDensity:
 * - low: ~800 chars (sparse claims from shorter videos)
 * - medium: ~1600 chars (moderate claims)
 * - high: ~3200 chars (dense claims from longer videos)
 */
const DRY_RUN_CLAIM_TEXT_LENGTH_ESTIMATE = {
  low: 800,
  medium: 1600,
  high: 3200,
} as const;

const estimateJudgeUsage = (
  fullText: string,
  claimSet: ClaimCandidate[],
  estimatedClaimTextLength = 0
): LlmTokenUsage => {
  const claimTextLen = claimSet.length > 0
    ? claimSet.reduce((acc, c) => acc + c.text.length, 0)
    : estimatedClaimTextLength;
  const estimatedClaimTokens = Math.ceil(claimTextLen / 4);
  const inputTokens = estimateTokens(fullText) + estimatedClaimTokens + JUDGE_PROMPT_OVERHEAD_TOKENS;
  const outputTokens = JUDGE_OUTPUT_TOKENS_ESTIMATE;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
};

/**
 * Estimates the USD cost for a judge to score a claim set.
 */
const estimateJudgeCost = (
  fullText: string,
  claimSet: ClaimCandidate[],
  model: EvalModel,
  estimatedClaimTextLength = 0
): number => {
  const usage = estimateJudgeUsage(fullText, claimSet, estimatedClaimTextLength);

  return (
    estimateCost(usage.inputTokens, model.costPer1kTokens.input) +
    estimateCost(usage.outputTokens, model.costPer1kTokens.output)
  );
};

const performExtraction = async (
  videoId: string,
  modelId: string,
  variant: ExtractorVariantId,
  options: MatrixOptions,
  requestSemaphore: Semaphore,
  resource: GraphNode,
  excerpts: GraphNode[],
  promptVersion: string,
  runtimePromptPackId?: ExtractionPromptPackId,
  promptRoutingDecision?: PromptRoutingDecision
): Promise<{
  claims: ClaimCandidate[];
  traces: { prompt: { system: string; user: string }; response: string }[];
  warnings?: string[];
  diagnostics: NonNullable<MatrixCell["extractionDiagnostics"]>;
}> => {
  return withRequestBudget(requestSemaphore, options.timeoutMs, async (signal) => {
    const chunkProfile = options.extractionChunkProfiles?.[modelId];
    const selfImproveHintKey = buildSelfImproveHintKey(videoId, variant, modelId, options.extractionPromptConfigId, options.extractionChunkModeId);
    const client = options.extractorClientFactory(modelId);
    const usesInternalRouting = runtimePromptPackId !== options.extractionPromptPackId;
    const extractor = new LlmClaimExtractor({
      client,
      model: modelId,
      promptVersion,
      cacheDir: options.cacheDir,
      editorVersion: variant === "editorial-pass-v1" ? "v1" : variant === "editorial-pass-v2" ? "v2" : undefined,
      editorLlm: variant.startsWith("editorial-pass-") || variant === "self-improve-v1",
      selfImproveMaxRounds: variant === "self-improve-v1" ? (options.extractionSelfImproveMaxRounds ?? 1) : 0,
      promptConfigId: options.extractionPromptConfigId,
      promptPackId: usesInternalRouting ? undefined : options.extractionPromptPackId,
      promptRoutingDecision: usesInternalRouting && promptRoutingDecision
        ? promptRoutingDecision
        : undefined,
      maxTokens: options.extractionMaxTokens,
      maxChunks: options.extractionMaxChunks,
      selfImproveGuidance: options.extractionSelfImproveHints?.[selfImproveHintKey],
      enablePromptRouting: options.extractionEnablePromptRouting,
      chunkStrategy: chunkProfile?.chunkStrategy ?? options.extractionChunkStrategy,
      chunkTargetInputTokens: chunkProfile?.targetInputTokens ?? options.extractionChunkTargetInputTokens,
      chunkHardMaxInputTokens: chunkProfile?.hardMaxInputTokens ?? options.extractionChunkHardMaxInputTokens,
      chunkOverlapExcerpts: chunkProfile?.overlapExcerpts ?? options.extractionChunkOverlapExcerpts,
      transportRetry: {
        maxAttempts: options.extractionTransportRetryMaxAttempts,
        baseDelayMs: options.extractionTransportRetryBaseDelayMs,
      },
      logger: options.logger,
    });

    const claims = await extractor.extractClaims({
      resource,
      excerpts,
      signal,
      collectTraces: true,
    });

    const runStats = extractor.getLastRunStats();
    const warnings: string[] = [];
    if (runStats.transportRetryCount > 0) {
      warnings.push(`transport-retries:${runStats.transportRetryCount}`);
    }
    if (runStats.fallbackChunkCount > 0) {
      warnings.push(`fallback-chunks:${runStats.fallbackChunkCount}`);
    }
    if (runStats.transientFailureCount > 0) {
      warnings.push(`transient-provider-errors:${runStats.transientFailureCount}`);
    }
    if (runStats.clientTimeoutCount > 0) {
      warnings.push(`client-timeouts:${runStats.clientTimeoutCount}`);
    }
    if (runStats.upstreamAbortCount > 0) {
      warnings.push(`upstream-aborts:${runStats.upstreamAbortCount}`);
    }
    if (runStats.retryTriggered) {
      warnings.push(`prompt-retry:${runStats.retryReason ?? "retry-triggered"}->${runStats.retryPromptPackId ?? "unknown"}`);
    }
    if (options.extractionSelfImproveHints?.[selfImproveHintKey]) {
      warnings.push("teacher-gap-hints-applied");
    }

    return {
      claims,
      traces: extractor.getLastTraces(),
      warnings,
      diagnostics: {
        transportRetryCount: runStats.transportRetryCount,
        fallbackChunkCount: runStats.fallbackChunkCount,
        transientFailureCount: runStats.transientFailureCount,
        clientTimeoutCount: runStats.clientTimeoutCount,
        upstreamAbortCount: runStats.upstreamAbortCount,
        chunkInputTokenCounts: runStats.chunkInputTokenCounts,
        maxChunkInputTokens: runStats.maxChunkInputTokens,
        selfImproveRoundCount: runStats.selfImproveRoundCount,
        promptPackId: runStats.promptPackId,
        routeSource: runStats.routeSource,
        routeConfidence: runStats.routeConfidence,
        routeSignals: runStats.routeSignals,
        retryTriggered: runStats.retryTriggered,
        retryReason: runStats.retryReason,
        retryPromptPackId: runStats.retryPromptPackId,
      },
    };
  });
};

const performScoring = async (
  modelId: string,
  judgeModelId: string,
  fullText: string,
  claimSet: ClaimCandidate[],
  videoContext: VideoContext,
  options: MatrixOptions,
  requestSemaphore: Semaphore
): Promise<{ score: ClaimSetScore; traces: Array<{ prompt: { system: string; user: string }; response: string }>; usage?: LlmTokenUsage }> => {
  return withRequestBudget(requestSemaphore, options.timeoutMs, async (signal) => {
    const judgeClient = options.judgeClientFactory(judgeModelId);
    const scoreResult = await scoreClaimSet(
      judgeClient,
      judgeModelId,
      fullText,
      claimSet,
      videoContext,
      options.judgeMaxTokens || 4000,
      signal
    );

    if (scoreResult.ok) {
      return scoreResult.value;
    } else {
      throw scoreResult.error;
    }
  });
};

interface JudgeScoreOutcome {
  judgeModelId: string;
  scores: ClaimSetScore[];
  judgeUsdEstimate: number;
  judgeUsdActual?: number;
  estimatedUsage?: LlmTokenUsage;
  traces?: Array<{ prompt: { system: string; user: string }; response: string }>;
  usage?: LlmTokenUsage;
  failure?: string;
}

function costFromUsage(usage: LlmTokenUsage, model: EvalModel): number {
  return estimateCost(usage.inputTokens, model.costPer1kTokens.input)
    + estimateCost(usage.outputTokens, model.costPer1kTokens.output);
}

function buildUsageProjection(estimated: LlmTokenUsage, model: EvalModel, actual?: LlmTokenUsage): UsageProjection {
  return {
    estimated,
    actual,
    estimatedCostUsd: costFromUsage(estimated, model),
    actualCostUsd: actual ? costFromUsage(actual, model) : undefined,
  };
}

function usageAvailability(usage: MatrixCell["usage"]): "estimated-only" | "partial-actual" | "complete-actual" {
  const projections = [usage?.extraction, usage?.judge].filter(Boolean) as UsageProjection[];
  if (projections.length === 0) return "estimated-only";
  const actualCount = projections.filter((projection) => projection.actual).length;
  if (actualCount === 0) return "estimated-only";
  return actualCount === projections.length ? "complete-actual" : "partial-actual";
}

const getScoreForJudge = async (
  video: CorpusEntry,
  model: EvalModel,
  cell: MatrixCell,
  options: MatrixOptions,
  requestSemaphore: Semaphore,
  fullText: string,
  videoContext: VideoContext,
  claimSetHash: string,
  judgePromptVersion: string,
  judgeModelId: string
): Promise<JudgeScoreOutcome> => {
  const judgeModel = getModel(judgeModelId);

  const cachedScores = options.resume && !options.dryRun
    ? await getCachedScore(
        video.videoId,
        model.id,
        judgeModelId,
        claimSetHash,
        judgePromptVersion,
        { cacheDir: options.cacheDir }
      )
    : null;

  if (cachedScores) {
    return { judgeModelId, scores: cachedScores, judgeUsdEstimate: 0 };
  }

  const estimatedUsage = estimateJudgeUsage(
    fullText,
    cell.claimSet,
    DRY_RUN_CLAIM_TEXT_LENGTH_ESTIMATE[video.expectedClaimDensity]
  );

  if (options.dryRun) {
    const judgeUsdEstimate = judgeModel ? costFromUsage(estimatedUsage, judgeModel) : 0;
    (options.logger ?? consoleLogger).info(`[dry-run] Would score claims for ${video.videoId} using ${judgeModelId}`);
    return { judgeModelId, scores: [], judgeUsdEstimate, estimatedUsage };
  }

  const judgeUsdEstimate = judgeModel
    ? costFromUsage(estimatedUsage, judgeModel)
    : 0;

  try {
    // Keep actual judge LLM calls within the shared matrix request budget so
    // multi-judge cells do not fan out past the user's configured limit.
    const scoreResult = await performScoring(
      model.id,
      judgeModelId,
      fullText,
      cell.claimSet,
      videoContext,
      options,
      requestSemaphore
    );

    const score = scoreResult.score;
    try {
      await setCachedScore(
        video.videoId,
        model.id,
        judgeModelId,
        claimSetHash,
        judgePromptVersion,
        [score],
        { cacheDir: options.cacheDir }
      );
    } catch (cacheErr) {
      (options.logger ?? consoleLogger).warn(`Failed to cache score for ${video.videoId} / ${model.id} by ${judgeModelId}: ${cacheErr}`);
    }

    return {
      judgeModelId,
      scores: [score],
      judgeUsdEstimate,
      judgeUsdActual: judgeModel && scoreResult.usage ? costFromUsage(scoreResult.usage, judgeModel) : undefined,
      estimatedUsage,
      traces: scoreResult.traces,
      usage: scoreResult.usage,
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Scoring timeout for ${video.videoId} / ${model.id} by ${judgeModelId}`
        : (err instanceof Error ? err.message : String(err));
    (options.logger ?? consoleLogger).error(`Scoring failed for ${video.videoId} / ${model.id} by ${judgeModelId}:`, message);
    return { judgeModelId, scores: [], judgeUsdEstimate, estimatedUsage, failure: message };
  }
};

const getScoresForCell = async (
  video: CorpusEntry,
  model: EvalModel,
  cell: MatrixCell,
  options: MatrixOptions,
  fullText: string,
  videoContext: VideoContext,
  claimSetHash: string,
  judgePromptVersion: string,
  requestSemaphore: Semaphore
): Promise<{
  scores: ClaimSetScore[];
  hasFailure: boolean;
  judgeUsdEstimate: number;
  judgeEstimatedUsage?: LlmTokenUsage;
  judgeUsage?: LlmTokenUsage;
  judgeUsdActual?: number;
  traces: Record<string, Array<{ prompt: { system: string; user: string }; response: string }>>;
  failures: Record<string, string>;
}> => {
  const scores: ClaimSetScore[] = [];
  let cellHasScoringFailure = false;
  let judgeUsdEstimate = 0;
  let judgeEstimatedUsage: LlmTokenUsage | undefined;
  let judgeUsage: LlmTokenUsage | undefined;
  let judgeUsdActual: number | undefined;
  const traces: Record<string, Array<{ prompt: { system: string; user: string }; response: string }>> = {};
  const judgeFailures: Record<string, string> = {};

  const outcomes = await Promise.allSettled(
    options.judgeModels.map((judgeModelId) => getScoreForJudge(
      video,
      model,
      cell,
      options,
      requestSemaphore,
      fullText,
      videoContext,
      claimSetHash,
      judgePromptVersion,
      judgeModelId
    ))
  );

  for (const [index, outcome] of outcomes.entries()) {
    const fallbackJudgeModelId = options.judgeModels[index] ?? `judge-${index}`;
    if (outcome.status === "rejected") {
      cellHasScoringFailure = true;
      judgeFailures[fallbackJudgeModelId] = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
      continue;
    }

    const result = outcome.value;
    scores.push(...result.scores);
    judgeUsdEstimate += result.judgeUsdEstimate;
    if (result.estimatedUsage) {
      judgeEstimatedUsage = judgeEstimatedUsage
        ? {
            inputTokens: judgeEstimatedUsage.inputTokens + result.estimatedUsage.inputTokens,
            outputTokens: judgeEstimatedUsage.outputTokens + result.estimatedUsage.outputTokens,
            totalTokens: judgeEstimatedUsage.totalTokens + result.estimatedUsage.totalTokens,
          }
        : result.estimatedUsage;
    }
    if (result.usage) {
      judgeUsage = judgeUsage
        ? {
            inputTokens: judgeUsage.inputTokens + result.usage.inputTokens,
            outputTokens: judgeUsage.outputTokens + result.usage.outputTokens,
            totalTokens: judgeUsage.totalTokens + result.usage.totalTokens,
          }
        : result.usage;
    }
    if (result.judgeUsdActual !== undefined) {
      judgeUsdActual = (judgeUsdActual ?? 0) + result.judgeUsdActual;
    }
    if (result.traces && result.traces.length > 0) {
      traces[result.judgeModelId] = result.traces;
    }
    if (result.failure) {
      cellHasScoringFailure = true;
      judgeFailures[result.judgeModelId] = result.failure;
    }
  }

  return { scores, hasFailure: cellHasScoringFailure, judgeUsdEstimate, judgeEstimatedUsage, judgeUsage, judgeUsdActual, traces, failures: judgeFailures };
};

const getExtractionForCell = async (
  video: CorpusEntry,
  model: EvalModel,
  variant: ExtractorVariantId,
  options: MatrixOptions,
  resource: GraphNode,
  excerpts: GraphNode[],
  promptVersion: string,
  extractorVersion: string,
  requestSemaphore: Semaphore
): Promise<MatrixCell | { error: { message: string } }> => {
  let runtimePromptPackId = options.extractionPromptPackId;
  let promptRoutingDecision: PromptRoutingDecision | undefined;
  if (options.extractionEnablePromptRouting) {
    const routing = decidePromptPack({
      topicDomain: resource.metadata?.["topicDomain"] as string | undefined,
      title: resource.label,
      transcriptText: resource.content as string,
    });
    promptRoutingDecision = routing.decision;
    // Only override explicit extractionPromptPackId when routing is high-confidence (>= 0.85)
    if (!runtimePromptPackId || routing.decision.routeConfidence >= 0.85) {
      runtimePromptPackId = routing.decision.promptPackId;
    }
  }

  const selfImproveMaxRounds = variant === "self-improve-v1" ? (options.extractionSelfImproveMaxRounds ?? 1) : 0;
  const selfImproveHintKey = buildSelfImproveHintKey(video.videoId, variant, model.id, options.extractionPromptConfigId, options.extractionChunkModeId);
  const selfImproveGuidanceObj = options.extractionSelfImproveHints?.[selfImproveHintKey];
  const selfImproveGuidance = selfImproveGuidanceObj ? JSON.stringify(selfImproveGuidanceObj) : undefined;

  // Check cache for extraction
  let cell: MatrixCell | null = null;
  if (options.resume && !options.dryRun) {
    cell = await getCachedExtraction(
      video.videoId,
      model.id,
      variant,
      promptVersion,
      extractorVersion,
      options.extractionPromptConfigId,
      options.extractionChunkModeId,
      runtimePromptPackId,
      selfImproveMaxRounds,
      selfImproveGuidance,
      { cacheDir: options.cacheDir }
    );
  }

  if (cell) return cell;

  const inputTokens = estimateTokens(resource.content as string) + 1000; // roughly 1k for prompt
  const outputTokens = 500;
  const extractionEstimatedUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
  const extractionUsd =
    (inputTokens / 1000) * model.costPer1kTokens.input +
    (outputTokens / 1000) * model.costPer1kTokens.output;
  const costEstimate = {
    extractionUsd,
    judgeUsd: 0,
    totalUsd: extractionUsd,
  };

  if (options.dryRun) {
    (options.logger ?? consoleLogger).info(`[dry-run] Would extract claims for ${video.videoId} using ${model.id}`);
    return {
      videoId: video.videoId,
      modelId: model.id,
      extractorVariantId: variant,
      promptConfigId: options.extractionPromptConfigId,
      claimSet: [],
      costEstimate,
      usage: {
        extraction: buildUsageProjection(extractionEstimatedUsage, model),
        availability: "estimated-only",
      },
    };
  }

  try {
    const extractionResult = await performExtraction(
      video.videoId,
      model.id,
      variant,
      options,
      requestSemaphore,
      resource,
      excerpts,
      promptVersion,
      runtimePromptPackId,
      promptRoutingDecision
    );

    const newCell: MatrixCell = {
      videoId: video.videoId,
      modelId: model.id,
      extractorVariantId: variant,
      promptConfigId: options.extractionPromptConfigId,
      claimSet: extractionResult.claims,
      costEstimate,
      usage: {
        extraction: buildUsageProjection(extractionEstimatedUsage, model),
        availability: "estimated-only",
      },
      warnings: extractionResult.warnings,
      extractionDiagnostics: extractionResult.diagnostics,
      traces: {
        extraction: extractionResult.traces,
      }
    };

    // Strip traces before caching to avoid disk bloat (traces contain full transcript in prompt)
    const { traces: _traces, ...cellWithoutTraces } = newCell;

    try {
      await setCachedExtraction(
        video.videoId,
        model.id,
        variant,
        promptVersion,
        extractorVersion,
        options.extractionPromptConfigId,
        options.extractionChunkModeId,
        runtimePromptPackId,
        selfImproveMaxRounds,
        selfImproveGuidance,
        cellWithoutTraces,
        { cacheDir: options.cacheDir }
      );
    } catch (cacheErr) {
      (options.logger ?? consoleLogger).warn(`Failed to cache extraction for ${video.videoId} / ${model.id}: ${cacheErr}`);
    }

    return newCell;
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Extraction timeout for ${video.videoId} / ${model.id}`
        : (err instanceof Error ? err.message : String(err));
    (options.logger ?? consoleLogger).error(message);
    return { error: { message } };
  }
};

const prepareTranscriptDataAsync = async (
  video: CorpusEntry,
  options: MatrixOptions
): Promise<
  | {
      videoContext: VideoContext;
      excerpts: GraphNode[];
      resource: GraphNode;
      fullText: string;
    }
  | { error: number }
> => {
  const logger = options.logger ?? consoleLogger;
  if (!isValidSafeId(video.videoId)) {
    logger.error(`Invalid videoId: ${video.videoId}`);
    return { error: 1 };
  }
  const transcriptPath = join(options.transcriptDir, `${video.videoId}.json`);

  let transcriptData: Transcript;
  try {
    const raw = await readFile(transcriptPath, "utf-8");
    const parsed = Transcript.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.error(`Invalid transcript format for ${video.videoId}:`, parsed.error.format());
      return { error: 1 };
    }
    transcriptData = parsed.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn(`Transcript not found for ${video.videoId} at ${transcriptPath}, skipping.`);
    } else {
      logger.error(`Failed to read or parse transcript for ${video.videoId}:`, err);
    }
    return { error: 1 };
  }

  const videoContext: VideoContext = {
    videoId: video.videoId,
    title: video.title,
    channelName: video.channelName,
    url: video.url,
    durationMinutes: video.durationMinutes,
    topicDomain: video.topicDomain,
    description: video.description,
  };

  const segments = transcriptData.segments;
  const fullText = transcriptData.fullText;

  const now = new Date().toISOString();
  const excerpts = segments.map((s, i: number) => ({
    schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION as 1,
    id: `excerpt-${video.videoId}-${i}`,
    type: "Excerpt" as const,
    label: `Excerpt ${i}`,
    content: s.text,
    metadata: {
      start: s.start,
      duration: s.duration,
      ...(typeof s.speaker === "string" ? { speaker: s.speaker } : {}),
    },
    createdAt: now,
    updatedAt: now,
  }));

  const resource = {
    schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION as 1,
    id: `youtube-${video.videoId}`,
    type: "Resource" as const,
    label: video.title,
    content: fullText,
    metadata: {
      videoId: video.videoId,
      channelName: video.channelName,
      description: video.description || "",
      topicDomain: video.topicDomain,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return { videoContext, excerpts, resource, fullText };
};

const processCell = async (
  cellIndex: number,
  totalCells: number,
  video: CorpusEntry,
  model: EvalModel,
  variant: ExtractorVariantId,
  options: MatrixOptions,
  transcriptDataResult:
    | {
        videoContext: VideoContext;
        excerpts: GraphNode[];
        resource: GraphNode;
        fullText: string;
      }
    | { error: number },
  semaphore: Semaphore,
  requestSemaphore: Semaphore,
  cells: MatrixCell[],
  onFailure: () => void,
  onPartialFailure: () => void
) => {
  await semaphore.acquire();
  const cellStartedAt = Date.now();
  const logger = options.logger ?? consoleLogger;
  try {
    const labelSuffix = options.cellLabelPrefix ? ` ${options.cellLabelPrefix}` : "";
    logger.info(`[cell ${cellIndex + 1}/${totalCells}${labelSuffix}] videoId=${video.videoId} modelId=${model.id} variant=${variant}`);

    if ("error" in transcriptDataResult) {
      cells.push({
        videoId: video.videoId,
        modelId: model.id,
        extractorVariantId: variant,
        promptConfigId: options.extractionPromptConfigId,
        claimSet: [],
        error: { message: `Transcript unavailable or malformed for ${video.videoId}` },
      });
      onFailure();
      return;
    }

    const { videoContext, excerpts, resource, fullText } = transcriptDataResult;
    const promptVersion = options.extractionPromptVersion ?? EXTRACT_PROMPT_VERSION;
    const extractorVersion = EXTRACTOR_VERSION;

    const extractionResult = await getExtractionForCell(
      video,
      model,
      variant,
      options,
      resource,
      excerpts,
      promptVersion,
      extractorVersion,
      requestSemaphore
    );

    if ("error" in extractionResult) {
      cells.push({
        videoId: video.videoId,
        modelId: model.id,
        extractorVariantId: variant,
        promptConfigId: options.extractionPromptConfigId,
        claimSet: [],
        error: extractionResult.error,
      });
      onFailure();
      return;
    }

    const cell = extractionResult;

    // Scoring
    if (!options.dryRun && cell.claimSet.length === 0) {
      logger.warn(`[skip-scoring] No claims extracted for ${video.videoId} / ${model.id}, skipping judge.`);
      cell.scores = [];
      cells.push(cell);
      return;
    }

    const claimSetHash = computeClaimSetHash(cell.claimSet);
    const judgePromptVersion = JUDGE_PROMPT_VERSION;

    const { scores, hasFailure, judgeUsdEstimate, judgeEstimatedUsage, judgeUsage, judgeUsdActual, traces: scoringTraces, failures: judgeFailures } = await getScoresForCell(
      video,
      model,
      cell,
      options,
      fullText,
      videoContext,
      claimSetHash,
      judgePromptVersion,
      requestSemaphore
    );

    if (hasFailure) {
      if (scores.length === 0) {
        cell.error = {
          message: "All judge scorings failed",
          details: judgeFailures
        };
        onFailure();
      } else {
        logger.warn(
          `${LOG_PREFIX_PARTIAL_SCORING} ${scores.length}/${options.judgeModels.length} judges succeeded for ${video.videoId} / ${model.id}`
        );
        onPartialFailure();
        cell.warnings = cell.warnings || [];
        cell.warnings.push(`Partial judge failure: ${formatErrorRecord(judgeFailures)}`);
      }
    }

    if (cell.costEstimate) {
      cell.costEstimate.judgeUsd = judgeUsdEstimate;
      cell.costEstimate.totalUsd += judgeUsdEstimate;
    }
    if (judgeEstimatedUsage) {
      cell.usage = {
        ...cell.usage,
        judge: {
          estimated: judgeEstimatedUsage,
          actual: judgeUsage,
          estimatedCostUsd: judgeUsdEstimate,
          actualCostUsd: judgeUsdActual,
        },
        availability: "estimated-only",
      };
      cell.usage.availability = usageAvailability(cell.usage);
    }

    cell.scores = scores;
    if (scoringTraces && Object.keys(scoringTraces).length > 0) {
      cell.traces = {
        ...cell.traces,
        scoring: scoringTraces,
      };
    }

    const consensus = computeConsensus(scores);
    if (consensus) {
      cell.consensusScore = {
        mean: consensus.mean,
        variance: consensus.variance,
        isHighVariance: consensus.isHighVariance,
      };
      if (consensus.isHighVariance) {
        logger.warn(`[high-variance] Cell ${video.videoId} / ${model.id} has high score variance between judges.`);
      }
    }

    cells.push(cell);
    const durationMs = Date.now() - cellStartedAt;
    logger.info(`[cell ${cellIndex + 1}/${totalCells}${labelSuffix}] done in ${durationMs}ms`);
  } finally {
    semaphore.release();
  }
};

/**
 * Runs an evaluation matrix across a corpus of videos and multiple models.
 *
 * @param corpus - Array of video entries from the evaluation corpus
 * @param models - Array of evaluation models to test
 * @param options - Configuration options including output dir, concurrency, variants, etc.
 * @returns MatrixResult containing cells with extraction/scoring results and metadata
 *
 * Behavior:
 * - Processes cells concurrently up to maxConcurrency limit
 * - Uses caching for extraction and scoring when available
 * - Supports dry-run mode that prints actions without executing
 * - Returns cells sorted by videoId, modelId, extractorVariantId for deterministic output
 */
export const runEvaluationMatrix = async (
  corpus: CorpusEntry[],
  models: EvalModel[],
  options: MatrixOptions
): Promise<MatrixResult> => {
  const startedAt = new Date().toISOString();
  const cells: MatrixCell[] = [];
  let failedCellCount = 0;
  let partialFailureCount = 0;

  const semaphore = new Semaphore(options.maxConcurrency || 1);
  const requestSemaphore = new Semaphore(options.maxConcurrency || 1);
  const tasks: Promise<void>[] = [];

  // Pre-load transcripts once per video to avoid redundant I/O and event loop blocking
  const transcriptCache = new Map<
    string,
    | {
        videoContext: VideoContext;
        excerpts: GraphNode[];
        resource: GraphNode;
        fullText: string;
      }
    | { error: number }
  >();

  await Promise.all(
    corpus.map(async (video) => {
      const data = await prepareTranscriptDataAsync(video, options);
      transcriptCache.set(video.videoId, data);
    })
  );

  const totalCells = corpus.length * models.length * options.variants.length;
  let currentCellIndex = 0;

  for (const video of corpus) {
    const transcriptDataResult = transcriptCache.get(video.videoId);
    // Defensive: this should never be undefined since we populated the cache above
    if (transcriptDataResult === undefined) {
      (options.logger ?? consoleLogger).error(`[internal] No transcript cache entry for ${video.videoId} - this is a bug`);
      continue;
    }

    for (const model of models) {
      for (const variant of options.variants) {
        tasks.push(
          processCell(
            currentCellIndex++,
            totalCells,
            video,
            model,
            variant,
            options,
            transcriptDataResult,
            semaphore,
            requestSemaphore,
            cells,
            () => {
              failedCellCount++;
            },
            () => {
              partialFailureCount++;
            }
          )
        );
      }
    }
  }

  await Promise.all(tasks);

  // Sort cells for deterministic output order
  cells.sort((a, b) => {
    const videoCompare = a.videoId.localeCompare(b.videoId);
    if (videoCompare !== 0) return videoCompare;
    const modelCompare = a.modelId.localeCompare(b.modelId);
    if (modelCompare !== 0) return modelCompare;
    return a.extractorVariantId.localeCompare(b.extractorVariantId);
  });

  // Filter out any functions from options for metadata
  const { extractorClientFactory: _extractorClientFactory, judgeClientFactory: _judgeClientFactory, ...serializableConfig } = options;

  return {
    cells,
    metadata: {
      startedAt,
      completedAt: new Date().toISOString(),
      runId: options.runId,
      config: serializableConfig as Record<string, unknown>,
      failedCellCount,
      partialFailureCount,
    },
  };
};
