import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "../utils/io.js";
import { join } from "node:path";
import { hashId } from "../utils/ids.js";
import type { MatrixCell } from "./matrix-runner.js";
import { ClaimSetScoreSchema, type ClaimSetScore } from "./scoring-rubric.js";
import type { ClaimCandidate } from "../extract/types.js";

/**
 * Serializes a value to a stable string representation for hashing.
 * Unlike JSON.stringify(), object keys are sorted alphabetically to ensure
 * consistent output regardless of insertion order.
 */
function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted = Object.keys(v).sort();
      const sortedObj: Record<string, unknown> = {};
      for (const key of sorted) {
        sortedObj[key] = (v as Record<string, unknown>)[key];
      }
      return sortedObj;
    }
    return v;
  });
}

export interface CacheOptions {
  cacheDir: string;
}

const UNDEFINED_CACHE_PART = "__undefined__";

function encodeCachePart(value: string | undefined): string {
  return value === undefined ? UNDEFINED_CACHE_PART : value;
}

function buildExtractionCacheFilePath(
  cacheDir: string,
  videoId: string,
  modelId: string,
  extractorVariantId: string,
  promptVersion: string,
  extractorVersion: string,
  promptConfigId: string | undefined,
  chunkMode: string | undefined,
  promptPackId: string | undefined,
  selfImproveMaxRounds: number,
  selfImproveGuidance: string | undefined
): string {
  const key = hashId("extraction", [
    videoId,
    modelId,
    extractorVariantId,
    promptVersion,
    extractorVersion,
    encodeCachePart(promptConfigId),
    encodeCachePart(chunkMode),
    encodeCachePart(promptPackId),
    String(selfImproveMaxRounds),
    encodeCachePart(selfImproveGuidance)
  ]);
  return join(cacheDir, `extraction-${key}.json`);
}

export async function getCachedExtraction(
  videoId: string,
  modelId: string,
  extractorVariantId: string,
  promptVersion: string,
  extractorVersion: string,
  promptConfigId: string | undefined,
  chunkMode: string | undefined,
  promptPackId: string | undefined,
  selfImproveMaxRounds: number,
  selfImproveGuidance: string | undefined,
  options: CacheOptions
): Promise<MatrixCell | null> {
  const filePath = buildExtractionCacheFilePath(
    options.cacheDir, videoId, modelId, extractorVariantId,
    promptVersion, extractorVersion, promptConfigId, chunkMode,
    promptPackId, selfImproveMaxRounds, selfImproveGuidance
  );

  try {
    const data = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    // Ideally we'd have a MatrixCellSchema here, but for now we validate key fields
    if (parsed && typeof parsed === 'object' && 'videoId' in parsed && 'modelId' in parsed && 'extractorVariantId' in parsed && 'claimSet' in parsed && Array.isArray(parsed.claimSet)) {
      return parsed as MatrixCell;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCachedExtraction(
  videoId: string,
  modelId: string,
  extractorVariantId: string,
  promptVersion: string,
  extractorVersion: string,
  promptConfigId: string | undefined,
  chunkMode: string | undefined,
  promptPackId: string | undefined,
  selfImproveMaxRounds: number,
  selfImproveGuidance: string | undefined,
  cell: MatrixCell,
  options: CacheOptions
): Promise<void> {
  const filePath = buildExtractionCacheFilePath(
    options.cacheDir, videoId, modelId, extractorVariantId,
    promptVersion, extractorVersion, promptConfigId, chunkMode,
    promptPackId, selfImproveMaxRounds, selfImproveGuidance
  );
  await writeJsonAtomic(filePath, cell);
}

export async function getCachedScore(
  videoId: string,
  extractionModelId: string,
  judgeModelId: string,
  claimSetHash: string,
  judgePromptVersion: string,
  options: CacheOptions
): Promise<ClaimSetScore[] | null> {
  const key = hashId("score", [videoId, extractionModelId, judgeModelId, claimSetHash, judgePromptVersion]);
  const filePath = join(options.cacheDir, `score-${key}.json`);

  try {
    const data = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    const result = ClaimSetScoreSchema.array().safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

export async function setCachedScore(
  videoId: string,
  extractionModelId: string,
  judgeModelId: string,
  claimSetHash: string,
  judgePromptVersion: string,
  scores: ClaimSetScore[],
  options: CacheOptions
): Promise<void> {
  const key = hashId("score", [videoId, extractionModelId, judgeModelId, claimSetHash, judgePromptVersion]);
  const filePath = join(options.cacheDir, `score-${key}.json`);

  await writeJsonAtomic(filePath, scores);
}

export function computeClaimSetHash(claims: ClaimCandidate[]): string {
  return hashId("claims", [stableSerialize(claims)]);
}
