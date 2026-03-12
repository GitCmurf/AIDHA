import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hashId } from "../utils/ids.js";
import type { MatrixCell } from "./matrix-runner.js";
import { ClaimSetScoreSchema, type ClaimSetScore } from "./scoring-rubric.js";
import type { ClaimCandidate } from "../extract/types.js";

export interface CacheOptions {
  cacheDir: string;
}

// Track which cache directories have been created to avoid redundant mkdir calls
const initializedCacheDirs = new Set<string>();

async function ensureCacheDir(cacheDir: string): Promise<void> {
  if (!initializedCacheDirs.has(cacheDir)) {
    await mkdir(cacheDir, { recursive: true });
    initializedCacheDirs.add(cacheDir);
  }
}

export async function getCachedExtraction(
  videoId: string,
  modelId: string,
  extractorVariantId: string,
  promptVersion: string,
  extractorVersion: string,
  options: CacheOptions
): Promise<MatrixCell | null> {
  const key = hashId("extraction", [videoId, modelId, extractorVariantId, promptVersion, extractorVersion]);
  const filePath = join(options.cacheDir, `extraction-${key}.json`);

  try {
    const data = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    // Ideally we'd have a MatrixCellSchema here, but for now we validate key fields
    if (parsed && typeof parsed === 'object' && 'videoId' in parsed && 'modelId' in parsed && 'claimSet' in parsed && Array.isArray(parsed.claimSet)) {
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
  cell: MatrixCell,
  options: CacheOptions
): Promise<void> {
  const key = hashId("extraction", [videoId, modelId, extractorVariantId, promptVersion, extractorVersion]);
  const filePath = join(options.cacheDir, `extraction-${key}.json`);

  await ensureCacheDir(options.cacheDir);
  await writeFile(filePath, JSON.stringify(cell, null, 2), "utf-8");
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

  await ensureCacheDir(options.cacheDir);
  await writeFile(filePath, JSON.stringify(scores, null, 2), "utf-8");
}

export function computeClaimSetHash(claims: ClaimCandidate[]): string {
  return hashId("claims", [JSON.stringify(claims)]);
}
