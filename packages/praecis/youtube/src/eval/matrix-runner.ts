import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { GraphNode } from "@aidha/graph-backend";
import { Transcript } from "../schema/transcript.js";
import type { ClaimCandidate } from "../extract/types.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { ClaimSetScore } from "./scoring-rubric.js";
import type { CorpusEntry } from "./corpus-schema.js";
import { getModel, type EvalModel } from "./model-registry.js";
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
import type { LlmClient } from "../extract/llm-client.js";
import { PROMPT_VERSION as EXTRACT_PROMPT_VERSION } from "../extract/prompts/pass1-claim-mining-v2.js";
import { JUDGE_PROMPT_VERSION } from "./prompts/judge-claim-quality.js";
import { isValidSafeId } from "../utils/ids.js";

export const EXTRACTOR_VERSION = "v1";

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
  judgeMaxTokens?: number;
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
  claimSet: ClaimCandidate[];
  scores?: ClaimSetScore[];
  consensusScore?: {
    mean: ClaimSetScore;
    variance: Partial<Record<ScoreDimension, number>>;
    isHighVariance: boolean;
  };
  error?: { message: string; code?: string };
  costEstimate?: {
    extractionUsd: number;
    judgeUsd: number;
    totalUsd: number;
  };
  traces?: {
    extraction?: { prompt: { system: string; user: string }; response: string }[];
    scoring?: Record<string, { prompt: { system: string; user: string }; response: string }[]>;
  };
}

export interface MatrixResult {
  cells: MatrixCell[];
  metadata: {
    startedAt: string;
    completedAt?: string;
    runId?: string;
    config: Record<string, unknown>; // Serializable config
    failedCellCount: number;
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

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const performExtraction = async (

  modelId: string,
  variant: ExtractorVariantId,
  options: MatrixOptions,
  resource: GraphNode,
  excerpts: GraphNode[],
  promptVersion: string
): Promise<{ claims: ClaimCandidate[]; traces: { prompt: { system: string; user: string }; response: string }[] }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const client = options.extractorClientFactory(modelId);
    const extractor = new LlmClaimExtractor({
      client,
      model: modelId,
      promptVersion,
      cacheDir: options.cacheDir,
      editorVersion: variant === "editorial-pass-v1" ? "v1" : variant === "editorial-pass-v2" ? "v2" : undefined,
      editorLlm: variant.startsWith("editorial-pass-"),
      maxTokens: options.extractionMaxTokens,
      maxChunks: options.extractionMaxChunks,
    });

    const claims = await extractor.extractClaims({
      resource,
      excerpts,
      signal: controller.signal,
      collectTraces: true,
    });

    return { claims, traces: extractor.getLastTraces() };
  } finally {
    clearTimeout(timeout);
  }
};

const performScoring = async (
  modelId: string,
  judgeModelId: string,
  fullText: string,
  claimSet: ClaimCandidate[],
  videoContext: VideoContext,
  options: MatrixOptions
): Promise<{ score: ClaimSetScore; traces: Array<{ prompt: { system: string; user: string }; response: string }> }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const judgeClient = options.judgeClientFactory(judgeModelId);
    const scoreResult = await scoreClaimSet(
      judgeClient,
      judgeModelId,
      fullText,
      claimSet,
      videoContext,
      options.judgeMaxTokens || 4000,
      controller.signal
    );

    if (scoreResult.ok) {
      return scoreResult.value;
    } else {
      throw scoreResult.error;
    }
  } finally {
    clearTimeout(timeout);
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
  judgePromptVersion: string
): Promise<{
  scores: ClaimSetScore[];
  hasFailure: boolean;
  judgeUsdEstimate: number;
  traces: Record<string, Array<{ prompt: { system: string; user: string }; response: string }>>;
}> => {
  const scores: ClaimSetScore[] = [];
  let cellHasScoringFailure = false;
  let judgeUsdEstimate = 0;
  const traces: Record<string, Array<{ prompt: { system: string; user: string }; response: string }>> = {};

  for (const judgeModelId of options.judgeModels) {
    const judgeModel = getModel(judgeModelId);
    if (judgeModel) {
      // Estimate judge cost (assume 1k prompt tokens + text + claims, ~200 output tokens)
      const claimTextLen = cell.claimSet?.reduce((acc, c) => acc + c.text.length, 0) || 0;
      const estimatedClaimTokens = Math.ceil(claimTextLen / 4);
      const inputTokens = estimateTokens(fullText) + estimatedClaimTokens + 1000;
      const outputTokens = 200;
      judgeUsdEstimate +=
        (inputTokens / 1000) * judgeModel.costPer1kTokens.input +
        (outputTokens / 1000) * judgeModel.costPer1kTokens.output;
    }

    const cachedScores = options.resume
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
      scores.push(...cachedScores);
    } else if (options.dryRun) {
      console.log(`[dry-run] Would score claims for ${video.videoId} using ${judgeModelId}`);
    } else {
      try {
        const scoreResult = await performScoring(
          model.id,
          judgeModelId,
          fullText,
          cell.claimSet,
          videoContext,
          options
        );

        const score = scoreResult.score;
        traces[judgeModelId] = scoreResult.traces;

        scores.push(score);
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
          console.warn(`Failed to cache score for ${video.videoId} / ${model.id} by ${judgeModelId}: ${cacheErr}`);
        }
      } catch (err) {
        const message =
          err instanceof Error && err.name === "AbortError"
            ? `Scoring timeout for ${video.videoId} / ${model.id} by ${judgeModelId}`
            : (err instanceof Error ? err.message : String(err));
        console.error(`Scoring failed for ${video.videoId} / ${model.id} by ${judgeModelId}:`, message);
        cellHasScoringFailure = true;
      }
    }
  }

  return { scores, hasFailure: cellHasScoringFailure, judgeUsdEstimate, traces };
};

const getExtractionForCell = async (
  video: CorpusEntry,
  model: EvalModel,
  variant: ExtractorVariantId,
  options: MatrixOptions,
  resource: GraphNode,
  excerpts: GraphNode[],
  promptVersion: string,
  extractorVersion: string
): Promise<MatrixCell | { error: { message: string } }> => {
  // Check cache for extraction
  let cell: MatrixCell | null = null;
  if (options.resume) {
    cell = await getCachedExtraction(
      video.videoId,
      model.id,
      variant,
      promptVersion,
      extractorVersion,
      { cacheDir: options.cacheDir }
    );
  }

  if (cell) return cell;

  const inputTokens = estimateTokens(resource.content as string) + 1000; // roughly 1k for prompt
  const outputTokens = 500;
  const extractionUsd =
    (inputTokens / 1000) * model.costPer1kTokens.input +
    (outputTokens / 1000) * model.costPer1kTokens.output;
  const costEstimate = {
    extractionUsd,
    judgeUsd: 0,
    totalUsd: extractionUsd,
  };

  if (options.dryRun) {
    console.log(`[dry-run] Would extract claims for ${video.videoId} using ${model.id}`);
    return {
      videoId: video.videoId,
      modelId: model.id,
      extractorVariantId: variant,
      claimSet: [],
      costEstimate,
    };
  }

  try {
    const extractionResult = await performExtraction(
      model.id,
      variant,
      options,
      resource,
      excerpts,
      promptVersion
    );

    const newCell: MatrixCell = {
      videoId: video.videoId,
      modelId: model.id,
      extractorVariantId: variant,
      claimSet: extractionResult.claims,
      costEstimate,
      traces: {
        extraction: extractionResult.traces,
      }
    };

    try {
      await setCachedExtraction(
        video.videoId,
        model.id,
        variant,
        promptVersion,
        extractorVersion,
        newCell,
        { cacheDir: options.cacheDir }
      );
    } catch (cacheErr) {
      console.warn(`Failed to cache extraction for ${video.videoId} / ${model.id}: ${cacheErr}`);
    }

    return newCell;
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Extraction timeout for ${video.videoId} / ${model.id}`
        : (err instanceof Error ? err.message : String(err));
    console.error(message);
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
  if (!isValidSafeId(video.videoId)) {
    console.error(`Invalid videoId: ${video.videoId}`);
    return { error: 1 };
  }
  const transcriptPath = path.join(options.transcriptDir, `${video.videoId}.json`);

  let transcriptData: Transcript;
  try {
    const raw = await readFile(transcriptPath, "utf-8");
    const parsed = Transcript.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(`Invalid transcript format for ${video.videoId}:`, parsed.error.format());
      return { error: 1 };
    }
    transcriptData = parsed.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`Transcript not found for ${video.videoId} at ${transcriptPath}, skipping.`);
    } else {
      console.error(`Failed to read or parse transcript for ${video.videoId}:`, err);
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

  const excerpts = segments.map((s, i: number) => ({
    id: `excerpt-${video.videoId}-${i}`,
    type: "Excerpt" as const,
    label: `Excerpt ${i}`,
    content: s.text,
    metadata: {
      start: s.start,
      duration: s.duration,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const resource = {
    id: `youtube-${video.videoId}`,
    type: "Resource" as const,
    label: video.title,
    content: fullText,
    metadata: {
      videoId: video.videoId,
      channelName: video.channelName,
      description: video.description || "",
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
  cells: MatrixCell[],
  onFailure: () => void
) => {
  await semaphore.acquire();
  const cellStartedAt = Date.now();
  try {
    console.log(`[cell ${cellIndex + 1}/${totalCells}] videoId=${video.videoId} modelId=${model.id} variant=${variant}`);

    if ("error" in transcriptDataResult) {
      cells.push({
        videoId: video.videoId,
        modelId: model.id,
        extractorVariantId: variant,
        claimSet: [],
        error: { message: `Transcript unavailable or malformed for ${video.videoId}` },
      });
      onFailure();
      return;
    }

    const { videoContext, excerpts, resource, fullText } = transcriptDataResult;
    const promptVersion = EXTRACT_PROMPT_VERSION;
    const extractorVersion = EXTRACTOR_VERSION;

    const extractionResult = await getExtractionForCell(
      video,
      model,
      variant,
      options,
      resource,
      excerpts,
      promptVersion,
      extractorVersion
    );

    if ("error" in extractionResult) {
      cells.push({
        videoId: video.videoId,
        modelId: model.id,
        extractorVariantId: variant,
        claimSet: [],
        error: extractionResult.error,
      });
      onFailure();
      return;
    }

    const cell = extractionResult;

    // Scoring
    if (!options.dryRun && cell.claimSet.length === 0) {
      console.warn(`[skip-scoring] No claims extracted for ${video.videoId} / ${model.id}, skipping judge.`);
      cell.scores = [];
      cells.push(cell);
      return;
    }

    const claimSetHash = computeClaimSetHash(cell.claimSet);
    const judgePromptVersion = JUDGE_PROMPT_VERSION;

    const { scores, hasFailure, judgeUsdEstimate, traces: scoringTraces } = await getScoresForCell(
      video,
      model,
      cell,
      options,
      fullText,
      videoContext,
      claimSetHash,
      judgePromptVersion
    );

    if (hasFailure) {
      cell.error = { message: "One or more judge scorings failed" };
      onFailure();
    }

    if (cell.costEstimate) {
      cell.costEstimate.judgeUsd = judgeUsdEstimate;
      cell.costEstimate.totalUsd += judgeUsdEstimate;
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
        console.warn(`[high-variance] Cell ${video.videoId} / ${model.id} has high score variance between judges.`);
      }
    }

    cells.push(cell);
    const durationMs = Date.now() - cellStartedAt;
    console.log(`[cell ${cellIndex + 1}/${totalCells}] done in ${durationMs}ms`);
  } finally {
    semaphore.release();
  }
};

export const runEvaluationMatrix = async (
  corpus: CorpusEntry[],
  models: EvalModel[],
  options: MatrixOptions
): Promise<MatrixResult> => {
  const startedAt = new Date().toISOString();
  const cells: MatrixCell[] = [];
  let failedCellCount = 0;

  const semaphore = new Semaphore(options.maxConcurrency || 1);
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
    if (!transcriptDataResult) continue;

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
            cells,
            () => {
              failedCellCount++;
            }
          )
        );
      }
    }
  }

  await Promise.all(tasks);

  // Filter out any functions from options for metadata
  const { extractorClientFactory, judgeClientFactory, ...serializableConfig } = options;

  return {
    cells,
    metadata: {
      startedAt,
      completedAt: new Date().toISOString(),
      runId: options.runId,
      config: serializableConfig as Record<string, unknown>,
      failedCellCount,
    },
  };
};
