import type { LlmClient } from "../extract/index.js";
import type { ExtractionPromptPackId } from "../extract/prompt-routing.js";
import {
  promptVersionForConfig,
  type Pass1PromptConfigId,
} from "../extract/prompts/pass1-claim-mining-v2.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { EvalModel } from "./model-registry.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import { runEvaluationMatrix, type MatrixCell, type MatrixOptions } from "./matrix-runner.js";
import { getNarrowEvalModelProfile, type NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { Logger } from "../utils/logger.js";
import type { SelfImproveHintInput } from "./teacher-analysis.js";

export async function runHarnessExtractionOnly(
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
  if (models.length === 0) {
    throw new Error('runHarnessExtractionOnly: models array must not be empty');
  }

  const chunkProfiles = Object.fromEntries(models.map((model) => {
    const profile = getNarrowEvalModelProfile(model.id, chunkMode);
    return [model.id, {
      chunkStrategy: profile.chunkStrategy,
      targetInputTokens: profile.targetInputTokens,
      hardMaxInputTokens: profile.hardMaxInputTokens,
      overlapExcerpts: profile.overlapExcerpts,
    }];
  }));

  const firstModelId = models[0]!.id;
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
