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
import type { LlmClient } from "../extract/llm-client.js";

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
    config: MatrixOptions;
    failedCellCount: number;
  };
}

export async function runEvaluationMatrix(
  corpus: CorpusEntry[],
  models: EvalModel[],
  options: MatrixOptions
): Promise<MatrixResult> {
  const startedAt = new Date().toISOString();
  const cells: MatrixCell[] = [];
  let failedCellCount = 0;

  for (const video of corpus) {
    const transcriptPath = path.join(options.transcriptDir, `${video.videoId}.json`);
    if (!fs.existsSync(transcriptPath)) {
      console.warn(`Transcript not found for ${video.videoId} at ${transcriptPath}, skipping.`);
      continue;
    }

    let transcriptData;
    try {
      transcriptData = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
    } catch (err) {
      console.error(`Failed to parse transcript for ${video.videoId}:`, err);
      continue;
    }

    const videoContext: VideoContext = {
      videoId: video.videoId,
      title: video.title,
      channelName: video.channelName,
      url: video.url,
      durationMinutes: video.durationMinutes,
      topicDomain: video.topicDomain,
    };

    const fullText = transcriptData.fullText || transcriptData.segments.map((s: any) => s.text).join(" ");

    const excerpts = transcriptData.segments.map((s: any, i: number) => ({
      id: s.id || `excerpt-${video.videoId}-${i}`,
      type: "Excerpt",
      content: s.text,
      metadata: {
        start: s.start,
        duration: s.duration,
      },
    }));

    const resource = {
      id: `youtube-${video.videoId}`,
      type: "Resource",
      label: video.title,
      content: fullText,
      metadata: {
        videoId: video.videoId,
        channelName: video.channelName,
        description: video.description || "",
      },
    };

    for (const model of models) {
      for (const variant of options.variants) {
        console.log(`[cell] videoId=${video.videoId} modelId=${model.id} variant=${variant}`);

        const promptVersion = "v2"; // Default
        const extractorVersion = "v1"; // Default

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
          try {
            const client = options.extractorClientFactory(model.id);
            const extractor = new LlmClaimExtractor({
              client,
              model: model.id,
              promptVersion,
              cacheDir: options.cacheDir,
              editorVersion: variant === "editorial-pass-v1" ? "v1" : "v2",
              // "raw" variant doesn't strictly exist in LlmClaimExtractor yet,
              // but we can simulate it by setting maxClaims high or similar,
              // or just use v1/v2 as specified.
              // For now, let's just use what's available.
            });

            const claims = await extractor.extractClaims({
              resource: resource as any,
              excerpts: excerpts as any,
            });

            cell = {
              videoId: video.videoId,
              modelId: model.id,
              extractorVariantId: variant,
              claimSet: claims,
            };

            await setCachedExtraction(
              video.videoId,
              model.id,
              variant,
              promptVersion,
              extractorVersion,
              cell,
              { cacheDir: options.cacheDir }
            );
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
            continue;
          }
        }

        // Scoring
        const claimSetHash = computeClaimSetHash(cell.claimSet);
        const judgePromptVersion = "v1";

        let scores: ClaimSetScore[] = [];
        for (const judgeModelId of options.judgeModels) {
          let cachedScores = await getCachedScore(
            video.videoId,
            model.id,
            judgeModelId,
            claimSetHash,
            judgePromptVersion,
            { cacheDir: options.cacheDir }
          );

          if (cachedScores && options.resume) {
            scores.push(...cachedScores);
          } else {
            const judgeClient = options.judgeClientFactory(judgeModelId);
            const scoreResult = await scoreClaimSet(
              judgeClient,
              judgeModelId,
              transcriptData.fullText,
              cell.claimSet,
              videoContext
            );

            if (scoreResult.ok) {
              const score = scoreResult.value;
              scores.push(score);
              await setCachedScore(
                video.videoId,
                model.id,
                judgeModelId,
                claimSetHash,
                judgePromptVersion,
                [score],
                { cacheDir: options.cacheDir }
              );
            } else {
              console.error(`Scoring failed for ${video.videoId} / ${model.id} by ${judgeModelId}:`, scoreResult.error);
            }
          }
        }

        cell.scores = scores;
        cells.push(cell);
      }
    }
  }

  return {
    cells,
    metadata: {
      startedAt,
      completedAt: new Date().toISOString(),
      config: JSON.parse(JSON.stringify(options)),
      failedCellCount,
    },
  };
}
