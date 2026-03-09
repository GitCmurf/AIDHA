import * as fs from "node:fs";
import * as path from "node:path";
import { Transcript } from "../schema/transcript.js";
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

async function processCell(
  video: CorpusEntry,
  model: EvalModel,
  variant: ExtractorVariantId,
  options: MatrixOptions,
  videoContext: VideoContext,
  excerpts: any[],
  resource: any,
  fullText: string,
  semaphore: Semaphore,
  cells: MatrixCell[],
  onFailure: () => void
) {
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
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

          const claims = await extractor.extractClaims({
            resource,
            excerpts,
            signal: controller.signal,
          });

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
          const message = err instanceof Error && err.name === 'AbortError'
            ? `Extraction timeout for ${video.videoId} / ${model.id}`
            : (err instanceof Error ? err.message : String(err));
          console.error(message);
          cells.push({
            videoId: video.videoId,
            modelId: model.id,
            extractorVariantId: variant,
            claimSet: [],
            error: { message },
          });
          onFailure();
          return;
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    // Scoring
    if (cell.claimSet.length === 0) {
      console.warn(`[skip-scoring] No claims extracted for ${video.videoId} / ${model.id}, skipping judge.`);
      cell.scores = [];
      cells.push(cell);
      return;
    }

    const claimSetHash = computeClaimSetHash(cell.claimSet);
    const judgePromptVersion = JUDGE_PROMPT_VERSION;

    const scores: ClaimSetScore[] = [];
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
        try {
          const judgeClient = options.judgeClientFactory(judgeModelId);
          const scoreResult = await scoreClaimSet(
            judgeClient,
            judgeModelId,
            fullText,
            cell.claimSet,
            videoContext,
            options.judgeMaxTokens || 4000,
            controller.signal
          );

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
            throw scoreResult.error;
          }
        } catch (err) {
          const message = err instanceof Error && err.name === 'AbortError'
            ? `Scoring timeout for ${video.videoId} / ${model.id} by ${judgeModelId}`
            : (err instanceof Error ? err.message : String(err));
          console.error(`Scoring failed for ${video.videoId} / ${model.id} by ${judgeModelId}:`, message);
          cellHasScoringFailure = true;
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    if (cellHasScoringFailure) {
      cell.error = { message: "One or more judge scorings failed" };
      onFailure();
    }

    cell.scores = scores;
    cells.push(cell);
  } finally {
    semaphore.release();
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

    let transcriptData: Transcript;
    try {
      const raw = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
      const parsed = Transcript.safeParse(raw);
      if (!parsed.success) {
        console.error(`Invalid transcript format for ${video.videoId}:`, parsed.error.format());
        failedCellCount += models.length * options.variants.length;
        continue;
      }
      transcriptData = parsed.data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`Transcript not found for ${video.videoId} at ${transcriptPath}, skipping.`);
      } else {
        console.error(`Failed to read or parse transcript for ${video.videoId}:`, err);
      }
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

    for (const model of models) {
      for (const variant of options.variants) {
        tasks.push(
          processCell(
            video,
            model,
            variant,
            options,
            videoContext,
            excerpts,
            resource,
            fullText,
            semaphore,
            cells,
            () => { failedCellCount++; }
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
      config: serializableConfig,
      failedCellCount,
    },
  };
}
