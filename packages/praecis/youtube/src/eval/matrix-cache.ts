import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type { MatrixCell } from "./matrix-runner.js";
import { ClaimSetScoreSchema, type ClaimSetScore } from "./scoring-rubric.js";

export interface CacheOptions {
  cacheDir: string;
}

function hashString(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex");
}

export async function getCachedExtraction(
  videoId: string,
  modelId: string,
  extractorVariantId: string,
  promptVersion: string,
  extractorVersion: string,
  options: CacheOptions
): Promise<MatrixCell | null> {
  const key = hashString(`${videoId}-${modelId}-${extractorVariantId}-${promptVersion}-${extractorVersion}`);
  const filePath = path.join(options.cacheDir, `extraction-${key}.json`);

  try {
    const data = await fs.readFile(filePath, "utf-8");
    // Just cast for extraction cell for now until we have full MatrixCell Zod schema
    return JSON.parse(data) as MatrixCell;
  } catch (error) {
    if ((error as any).code === "ENOENT") {
      return null;
    }
    throw error;
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
  const key = hashString(`${videoId}-${modelId}-${extractorVariantId}-${promptVersion}-${extractorVersion}`);
  const filePath = path.join(options.cacheDir, `extraction-${key}.json`);

  await fs.mkdir(options.cacheDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(cell, null, 2), "utf-8");
}

export async function getCachedScore(
  videoId: string,
  extractionModelId: string,
  judgeModelId: string,
  claimSetHash: string,
  judgePromptVersion: string,
  options: CacheOptions
): Promise<ClaimSetScore[] | null> {
  const key = hashString(`${videoId}-${extractionModelId}-${judgeModelId}-${claimSetHash}-${judgePromptVersion}`);
  const filePath = path.join(options.cacheDir, `score-${key}.json`);

  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    return ClaimSetScoreSchema.array().parse(parsed);
  } catch (error) {
    if ((error as any).code === "ENOENT") {
      return null;
    }
    throw error;
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
  const key = hashString(`${videoId}-${extractionModelId}-${judgeModelId}-${claimSetHash}-${judgePromptVersion}`);
  const filePath = path.join(options.cacheDir, `score-${key}.json`);

  await fs.mkdir(options.cacheDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(scores, null, 2), "utf-8");
}

export function computeClaimSetHash(claims: any[]): string {
  return hashString(JSON.stringify(claims));
}
