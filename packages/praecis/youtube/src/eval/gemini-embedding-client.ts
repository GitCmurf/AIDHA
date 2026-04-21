import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../pipeline/types.js";
import { requestRateLimiterRegistry } from "./request-rate-limiter.js";

export interface GeminiEmbeddingClientConfig {
  apiKey: string;
  baseUrl: string;
  cacheDir: string;
  timeoutMs?: number;
  model?: string;
  outputDimensionality?: number;
  taskType?: "SEMANTIC_SIMILARITY" | "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" | "CLASSIFICATION" | "CLUSTERING";
  maxRequestsPerMinute?: number;
}

interface CachedEmbedding {
  textHash: string;
  vector: number[];
}

export interface EmbeddingSimilarityScore {
  score: number;
  ok: boolean;
}

const DEFAULT_MODEL = "gemini-embedding-2-preview";
const DEFAULT_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TASK_TYPE: NonNullable<GeminiEmbeddingClientConfig["taskType"]> = "SEMANTIC_SIMILARITY";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizeEmbeddingText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function cacheKeyForText(model: string, taskType: string, outputDimensionality: number, text: string): string {
  return `${model}-${taskType}-${outputDimensionality}-${hashText(text)}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class GeminiEmbeddingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly cacheDir: string;
  private readonly timeoutMs: number;
  private readonly model: string;
  private readonly outputDimensionality: number;
  private readonly taskType: NonNullable<GeminiEmbeddingClientConfig["taskType"]>;
  private readonly maxRequestsPerMinute: number;
  private apiRequestCount = 0;
  private cacheHitCount = 0;
  private cacheMissCount = 0;

  constructor(config: GeminiEmbeddingClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.cacheDir = config.cacheDir;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = config.model ?? DEFAULT_MODEL;
    this.outputDimensionality = config.outputDimensionality ?? DEFAULT_OUTPUT_DIMENSIONALITY;
    this.taskType = config.taskType ?? DEFAULT_TASK_TYPE;
    this.maxRequestsPerMinute = config.maxRequestsPerMinute ?? 80;
  }

  async similarity(textA: string, textB: string): Promise<Result<EmbeddingSimilarityScore>> {
    const embeddingA = await this.getEmbedding(textA);
    if (!embeddingA.ok) return embeddingA;
    const embeddingB = await this.getEmbedding(textB);
    if (!embeddingB.ok) return embeddingB;

    return {
      ok: true,
      value: {
        score: cosineSimilarity(embeddingA.value, embeddingB.value),
        ok: true,
      },
    };
  }

  async prewarm(texts: string[], concurrency: number = 8): Promise<Result<{ warmed: number; failed: number }>> {
    const uniqueTexts = [...new Set(texts.map((text) => normalizeEmbeddingText(text)).filter(Boolean))];
    let warmed = 0;
    let failed = 0;

    for (let index = 0; index < uniqueTexts.length; index += concurrency) {
      const batch = uniqueTexts.slice(index, index + concurrency);
      const results = await Promise.all(batch.map((text) => this.getEmbedding(text)));
      for (const result of results) {
        if (result.ok) warmed += 1;
        else failed += 1;
      }
    }

    return { ok: true, value: { warmed, failed } };
  }

  async getEmbedding(text: string): Promise<Result<number[]>> {
    return this.embed(text);
  }

  getStats(): { apiRequestCount: number; cacheHitCount: number; cacheMissCount: number } {
    return {
      apiRequestCount: this.apiRequestCount,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
    };
  }

  private async embed(text: string): Promise<Result<number[]>> {
    const normalized = normalizeEmbeddingText(text);
    if (normalized.length === 0) {
      return { ok: false, error: new Error("Cannot embed empty text") };
    }

    const cacheKey = cacheKeyForText(this.model, this.taskType, this.outputDimensionality, normalized);
    const cachePath = join(this.cacheDir, `${cacheKey}.json`);
    const cached = await this.readCache(cachePath, normalized);
    if (cached) {
      this.cacheHitCount += 1;
      return { ok: true, value: cached.vector };
    }
    this.cacheMissCount += 1;

    const waitMs = await requestRateLimiterRegistry.waitForSlot(this.model, this.maxRequestsPerMinute);
    if (waitMs > 0) {
      console.log(`[rate-limit-wait] model=${this.model} waitMs=${waitMs}`);
    }

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    try {
      this.apiRequestCount += 1;
      const response = await fetch(
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:embedContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            model: `models/${this.model}`,
            taskType: this.taskType,
            outputDimensionality: this.outputDimensionality,
            content: {
              parts: [{ text: normalized }],
            },
          }),
          signal: timeoutSignal,
        }
      );

      if (!response.ok) {
        const textBody = await response.text();
        return {
          ok: false,
          error: new Error(`Gemini embedding request failed (${response.status}): ${textBody.slice(0, 500)}`),
        };
      }

      const json = (await response.json()) as {
        embedding?: {
          values?: number[];
        };
      };
      const values = json.embedding?.values;
      if (!Array.isArray(values) || values.length === 0) {
        return { ok: false, error: new Error("Gemini embedding response missing vector values") };
      }

      await this.writeCache(cachePath, normalized, values);
      return { ok: true, value: values };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  private async readCache(cachePath: string, normalizedText: string): Promise<CachedEmbedding | null> {
    try {
      const raw = await readFile(cachePath, "utf-8");
      const parsed = JSON.parse(raw) as CachedEmbedding;
      if (parsed.textHash !== hashText(normalizedText)) return null;
      if (!Array.isArray(parsed.vector) || parsed.vector.length === 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeCache(cachePath: string, normalizedText: string, vector: number[]): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const payload: CachedEmbedding = {
      textHash: hashText(normalizedText),
      vector,
    };
    await writeFile(cachePath, JSON.stringify(payload));
  }
}
