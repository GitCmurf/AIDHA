import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { MatrixCell } from "./matrix-runner.js";
import type {
  NarrowComparisonVideoReport,
  NarrowRunMode,
  NarrowStageId,
} from "./narrow-manual-baseline.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type { ExtractionPromptPackId } from "../extract/prompt-routing.js";
import { writeJsonAtomic } from "../utils/io.js";

export interface NarrowShortlistTarget {
  videoId: string;
  modelId: string;
  promptConfigId: Pass1PromptConfigId;
  chunkMode: NarrowEvalChunkMode;
  candidateId: string;
  promptPackId?: ExtractionPromptPackId;
}

export interface NarrowShortlistStageArtifact {
  stage: "shortlist";
  mode: NarrowRunMode;
  createdAt: string;
  inputSignature: string;
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  stage1Variants: ExtractorVariantId[];
  initialHarnessCells: MatrixCell[];
  fallbackTriggeredFor: string[];
  fallbackCells: MatrixCell[];
  videos: NarrowComparisonVideoReport[];
  shortlistTargets: NarrowShortlistTarget[];
  escalatedVideos?: string[];
  escalationReasonsByVideo?: Record<string, string[]>;
}

export interface NarrowRefineStageArtifact {
  stage: "refine";
  mode: NarrowRunMode;
  createdAt: string;
  inputSignature: string;
  stage2Variants: ExtractorVariantId[];
  refinedTargets: NarrowShortlistTarget[];
  refinedSelfImproveCells: MatrixCell[];
  finalHarnessCells: MatrixCell[];
}

export interface NarrowScoreStageArtifact {
  stage: "score";
  mode: NarrowRunMode;
  createdAt: string;
  inputSignature: string;
  videos: NarrowComparisonVideoReport[];
}

export interface NarrowJudgeStageArtifact {
  stage: "judge";
  mode: NarrowRunMode;
  createdAt: string;
  inputSignature: string;
  videos: NarrowComparisonVideoReport[];
}

export interface NarrowVideoScoreArtifact {
  stage: "score-video";
  mode: NarrowRunMode;
  createdAt: string;
  videoId: string;
  inputSignature: string;
  video: NarrowComparisonVideoReport;
}

const NarrowShortlistStageArtifactSchema = z.object({
  stage: z.literal("shortlist"),
  inputSignature: z.string().min(1),
  initialHarnessCells: z.array(z.unknown()),
  fallbackTriggeredFor: z.array(z.string()),
  fallbackCells: z.array(z.unknown()),
  videos: z.array(z.unknown()),
  shortlistTargets: z.array(z.unknown()),
}).passthrough();

const NarrowRefineStageArtifactSchema = z.object({
  stage: z.literal("refine"),
  inputSignature: z.string().min(1),
  refinedTargets: z.array(z.unknown()),
  refinedSelfImproveCells: z.array(z.unknown()),
  finalHarnessCells: z.array(z.unknown()),
}).passthrough();

const NarrowScoreStageArtifactSchema = z.object({
  stage: z.literal("score"),
  inputSignature: z.string().min(1),
  videos: z.array(z.unknown()),
}).passthrough();

const NarrowJudgeStageArtifactSchema = z.object({
  stage: z.literal("judge"),
  inputSignature: z.string().min(1),
  videos: z.array(z.unknown()),
}).passthrough();

const NarrowVideoScoreArtifactSchema = z.object({
  stage: z.literal("score-video"),
  videoId: z.string().min(1),
  inputSignature: z.string().min(1),
  video: z.unknown(),
}).passthrough();

const NarrowStageArtifactSchemas = {
  shortlist: NarrowShortlistStageArtifactSchema,
  refine: NarrowRefineStageArtifactSchema,
  score: NarrowScoreStageArtifactSchema,
  judge: NarrowJudgeStageArtifactSchema,
  report: z.object({ stage: z.literal("report") }).passthrough(),
} as const;

function buildNarrowStagePath(outputDir: string, stage: NarrowStageId): string {
  return join(outputDir, "stages", `${stage}.json`);
}

function buildNarrowVideoScorePath(outputDir: string, videoId: string): string {
  return join(outputDir, "stages", `score-video-${videoId}.json`);
}

export async function writeNarrowStageArtifact<T>(
  outputDir: string,
  stage: NarrowStageId,
  payload: T
): Promise<void> {
  await writeJsonAtomic(buildNarrowStagePath(outputDir, stage), payload);
}

// Returns undefined only for ENOENT; re-throws all other errors.
async function readJsonArtifact<T>(filePath: string, schema?: z.ZodTypeAny): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return (schema ? schema.parse(parsed) : parsed) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

export async function readNarrowStageArtifact<T>(
  outputDir: string,
  stage: NarrowStageId
): Promise<T | undefined> {
  return readJsonArtifact<T>(buildNarrowStagePath(outputDir, stage), NarrowStageArtifactSchemas[stage]);
}

export async function writeNarrowVideoScoreArtifact(
  outputDir: string,
  payload: NarrowVideoScoreArtifact
): Promise<void> {
  await writeJsonAtomic(buildNarrowVideoScorePath(outputDir, payload.videoId), payload);
}

export async function readNarrowVideoScoreArtifact(
  outputDir: string,
  videoId: string
): Promise<NarrowVideoScoreArtifact | undefined> {
  return readJsonArtifact<NarrowVideoScoreArtifact>(
    buildNarrowVideoScorePath(outputDir, videoId),
    NarrowVideoScoreArtifactSchema
  );
}
