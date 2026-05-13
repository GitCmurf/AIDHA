import { join } from "node:path";
import type { CorpusEntry } from "./corpus-schema.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import { computeClaimSetHash } from "./matrix-cache.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { NarrowShortlistTarget } from "./stage-artifact-store.js";
import type { SelfImproveHintInput } from "./teacher-analysis.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import { normalizeKey } from "../extract/utils.js";
import { hashFile, hashId } from "../utils/ids.js";
import type {
  ComparableClaimSet,
  NarrowRunMode,
} from "./narrow-report-types.js";

export type NarrowStageSignatureBaseInput = {
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

async function hashFiles(filePaths: string[]): Promise<string> {
  const hashes = await Promise.all(filePaths.map((p) => hashFile(p)));
  return hashId("files", hashes.filter(Boolean) as string[]);
}

async function buildNarrowStageSignaturePayload(input: NarrowStageSignatureBaseInput): Promise<NarrowStageSignaturePayload> {
  const corpusVideoIds = [...new Set(input.corpus.map((video) => video.videoId))].sort();
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
    candidates: [...input.comparableClaimSets]
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        sourceKind: candidate.sourceKind,
        claimSetHash: computeClaimSetHash(candidate.claims),
      })),
  })]);
}

export function buildRefineStageInputSignature(input: {
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
