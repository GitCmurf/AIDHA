import * as fs from "node:fs";
import * as path from "node:path";
import type { ClaimCandidate } from "../extract/types.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { ClaimSetScore } from "./scoring-rubric.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { EvalModel } from "./model-registry.js";
import { getCachedExtraction, setCachedExtraction, getCachedScore, setCachedScore, computeClaimSetHash } from "./matrix-cache.js";
import { scoreClaimSet } from "./scoring-executor.js";
import { LlmClaimExtractor } from "../extract/llm-claims.js";
import type { YouTubeClient } from "../client/types.js";
import type { LlmClient } from "../extract/llm-client.js";
import { PROMPT_VERSION as EXTRACT_PROMPT_VERSION } from "../extract/prompts/pass1-claim-mining-v2.js";
import { JUDGE_PROMPT_VERSION } from "./prompts/judge-claim-quality.js";

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
  variants: ExtractorVariantId[];
  judgeModels: string[];
  maxConcurrency: number;
  timeoutMs: number;
  extractionMaxTokens?: number;
  extractionMaxChunks?: number;
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
  };
  error?: { message: string; code?: string };
}

export interface MatrixResult {
  cells: MatrixCell[];
  metadata: {
    startedAt: string;
    completedAt?: string;
    config: any; // Serializable config
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
    return new Promise(resolve => this.waiting.push(resolve));
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

export async function runEvaluationMatrix(
  corpus: CorpusEntry[],
  models: EvalModel[],
  options: MatrixOptions
): Promise<MatrixResult> {
  const startedAt = new Date().toISOString();
  const cells: MatrixCell[] = [];
  let failedCellCount = 0;

  const semaphore = new Semaphore(options.maxConcurrency || 1);

  const tasks: Promise<void>[] = [];

  for (const video of corpus) {
    const transcriptPath = path.join(options.transcriptDir, `${video.videoId}.json`);
    if (!fs.existsSync(transcriptPath)) {
      console.warn(`Transcript not found for ${video.videoId} at ${transcriptPath}, skipping.`);
      failedCellCount += models.length * options.variants.length;
      continue;
    }

    let transcriptData;
    try {
      transcriptData = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
    } catch (err) {
      console.error(`Failed to parse transcript for ${video.videoId}:`, err);
      failedCellCount += models.length * options.variants.length;
      continue;
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

    const segments = transcriptData.segments || [];
    if (segments.length === 0 && !transcriptData.fullText) {
      console.warn(`Transcript for ${video.videoId} has no segments and no fullText, skipping.`);
      failedCellCount += models.length * options.variants.length;
      continue;
    }
    const fullText = transcriptData.fullText || segments.map((s: any) => s.text).join(" ");

    const excerpts = segments.map((s: any, i: number) => ({
      id: s.id || `excerpt-${video.videoId}-${i}`,
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

    for (const model of models) {
      for (const variant of options.variants) {
        tasks.push((async () => {
          await semaphore.acquire();
          try {
            console.log(`[cell] videoId=${video.videoId} modelId=${model.id} variant=${variant}`);

            const promptVersion = EXTRACT_PROMPT_VERSION;
            const extractorVersion = EXTRACTOR_VERSION;

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

            if (!cell) {
              if (options.dryRun) {
                console.log(`[dry-run] Would extract claims for ${video.videoId} using ${model.id}`);
                cell = {
                  videoId: video.videoId,
                  modelId: model.id,
                  extractorVariantId: variant,
                  claimSet: [],
                };
              } else {
                try {
                  const client = options.extractorClientFactory(model.id);
                  const extractor = new LlmClaimExtractor({
                    client,
                    model: model.id,
                    promptVersion,
                    cacheDir: options.cacheDir,
                    editorVersion: variant === "editorial-pass-v1" ? "v1" : "v2",
                    editorLlm: variant !== "raw", // Disable LLM rewrite for raw variant
                    maxTokens: options.extractionMaxTokens,
                    maxChunks: options.extractionMaxChunks,
                  });

                  const extractPromise = extractor.extractClaims({
                    resource,
                    excerpts,
                  });

                  const claims = await withTimeout(extractPromise, options.timeoutMs, `Extraction timeout for ${video.videoId} / ${model.id}`);

                  cell = {
                    videoId: video.videoId,
                    modelId: model.id,
                    extractorVariantId: variant,
                    claimSet: claims,
                  };

                  try {
                    await setCachedExtraction(
                      video.videoId,
                      model.id,
                      variant,
                      promptVersion,
                      extractorVersion,
                      cell,
                      { cacheDir: options.cacheDir }
                    );
                  } catch (cacheErr) {
                    console.warn(`Failed to cache extraction for ${video.videoId} / ${model.id}: ${cacheErr}`);
                  }
                } catch (err) {
                  console.error(`Extraction failed for ${video.videoId} / ${model.id}:`, err);
                  cells.push({
                    videoId: video.videoId,
                    modelId: model.id,
                    extractorVariantId: variant,
                    claimSet: [],
                    error: { message: err instanceof Error ? err.message : String(err) },
                  });
                  failedCellCount++;
                  return;
                }
              }
            }

            // Scoring
            const claimSetHash = computeClaimSetHash(cell.claimSet);
            const judgePromptVersion = JUDGE_PROMPT_VERSION;

            let scores: ClaimSetScore[] = [];
            let cellHasScoringFailure = false;

            for (const judgeModelId of options.judgeModels) {
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
                const judgeClient = options.judgeClientFactory(judgeModelId);
                const scorePromise = scoreClaimSet(
                  judgeClient,
                  judgeModelId,
                  fullText,
                  cell.claimSet,
                  videoContext
                );

                const scoreResult = await withTimeout(scorePromise, options.timeoutMs, `Scoring timeout for ${video.videoId} / ${model.id} by ${judgeModelId}`)
                  .catch(err => ({ ok: false as const, error: err }));

                if (scoreResult.ok) {
                  const score = scoreResult.value;
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
                } else {
                  console.error(`Scoring failed for ${video.videoId} / ${model.id} by ${judgeModelId}:`, scoreResult.error);
                  cellHasScoringFailure = true;
                  // Push a dummy score with error info to preserve array length and judge identity
                  scores.push({
                    completeness: 0, accuracy: 0, topicCoverage: 0, atomicity: 0, overallScore: 0,
                    reasoning: `ERROR: ${scoreResult.error.message}`,
                    missingClaims: [], hallucinations: [], redundancies: [], gapAreas: [],
                    judgeMeta: { judgeModelId, judgePromptVersion }
                  });
                }
              }
            }

            if (cellHasScoringFailure) {
              cell.error = { message: "One or more judge scorings failed" };
              failedCellCount++;
            }

            cell.scores = scores;
            cells.push(cell);
          } finally {
            semaphore.release();
          }
        })());
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
      config: serializableConfig,
      failedCellCount,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
