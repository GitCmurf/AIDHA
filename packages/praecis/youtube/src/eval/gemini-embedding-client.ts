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
  batchSize?: number;
  maxRetries?: number;
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
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

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
  private readonly batchSize: number;
  private readonly maxRetries: number;
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
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
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

  async prewarm(texts: string[]): Promise<Result<{ warmed: number; failed: number }>> {
    const uniqueTexts = [...new Set(texts.map((text) => normalizeEmbeddingText(text)).filter(Boolean))];
    const result = await this.embedBatch(uniqueTexts);
    if (!result.ok) return result;

    const warmed = result.value.filter(v => v !== null).length;
    const failed = result.value.length - warmed;
    return { ok: true, value: { warmed, failed } };
  }

  async embedBatch(texts: string[]): Promise<Result<Array<number[] | null>>> {
    const normalized = texts.map(t => normalizeEmbeddingText(t));
    const results: Array<number[] | null> = new Array(normalized.length).fill(null);
    const toFetch: Array<{ text: string; index: number }> = [];

    // Check cache in parallel but process results sequentially to preserve order
    const cacheResults = await Promise.all(normalized.map(async (text) => {
      if (!text) return null;
      const cacheKey = cacheKeyForText(this.model, this.taskType, this.outputDimensionality, text);
      const cachePath = join(this.cacheDir, `${cacheKey}.json`);
      return this.readCache(cachePath, text);
    }));

    cacheResults.forEach((cached, i) => {
      const text = normalized[i];
      if (!text) return;

      if (cached) {
        results[i] = cached.vector;
        this.cacheHitCount += 1;
      } else {
        toFetch.push({ text, index: i });
        this.cacheMissCount += 1;
      }
    });

    if (toFetch.length === 0) return { ok: true, value: results };

    // Batch fetch remaining
    for (let i = 0; i < toFetch.length; i += this.batchSize) {
      const chunk = toFetch.slice(i, i + this.batchSize);
      const chunkTexts = chunk.map(c => c.text);
      const batchResult = await this.embedBatchWithRetryAndSplit(chunkTexts);

      if (batchResult.ok) {
        batchResult.value.forEach((vector, j) => {
          if (vector) {
            const originalIndex = chunk[j]!.index;
            results[originalIndex] = vector;
          }
        });
      }
    }

    return { ok: true, value: results };
  }

  private async embedBatchWithRetryAndSplit(texts: string[]): Promise<Result<Array<number[] | null>>> {
    if (texts.length === 0) return { ok: true, value: [] };

    const result = await this.fetchWithRetry(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          requests: texts.map(text => ({
            model: `models/${this.model}`,
            taskType: this.taskType,
            outputDimensionality: this.outputDimensionality,
            content: { parts: [{ text }] },
          })),
        }),
      }
    );

    if (!result.ok) {
      // If batch failed with unretryable error (or exhausted retries), split it
      if (texts.length === 1) {
        return { ok: false, error: result.error };
      }

      const mid = Math.floor(texts.length / 2);
      const left = await this.embedBatchWithRetryAndSplit(texts.slice(0, mid));
      const right = await this.embedBatchWithRetryAndSplit(texts.slice(mid));

      const combined: Array<number[] | null> = [];
      if (left.ok) combined.push(...left.value); else combined.push(...new Array(mid).fill(null));
      if (right.ok) combined.push(...right.value); else combined.push(...new Array(texts.length - mid).fill(null));

      return { ok: true, value: combined };
    }

    const json = result.value as {
      embeddings?: Array<{
        values?: number[];
      }>;
    };

    const embeddings = json.embeddings ?? [];
    const values = await Promise.all(embeddings.map(async (e, i) => {
      const v = e.values;
      if (Array.isArray(v) && v.length > 0) {
        // Write to cache
        const text = texts[i]!;
        const cacheKey = cacheKeyForText(this.model, this.taskType, this.outputDimensionality, text);
        const cachePath = join(this.cacheDir, `${cacheKey}.json`);
        await this.writeCache(cachePath, text, v);
        return v;
      }
      return null;
    }));

    return { ok: true, value: values };
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Result<unknown>> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const waitMs = await requestRateLimiterRegistry.waitForSlot(this.model, this.maxRequestsPerMinute);
      if (waitMs > 0) {
        console.log(`[rate-limit-wait] model=${this.model} waitMs=${waitMs}`);
      }

      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      try {
        this.apiRequestCount += 1;
        const response = await fetch(url, { ...init, signal: timeoutSignal });

        if (response.ok) {
          return { ok: true, value: await response.json() };
        }

        const isRetryable = response.status === 429 || response.status >= 500;
        const errorText = await response.text();
        lastError = new Error(`Gemini API failed (${response.status}): ${errorText.slice(0, 500)}`);

        if (!isRetryable || attempt === this.maxRetries) {
          return { ok: false, error: lastError };
        }

        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt);

        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxRetries) return { ok: false, error: lastError };
        await new Promise(resolve => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt)));
      }
    }
    return { ok: false, error: lastError ?? new Error("Unknown fetch error") };
  }

  async getEmbedding(text: string): Promise<Result<number[]>> {
    const result = await this.embedBatch([text]);
    if (!result.ok) return result;
    const vector = result.value[0];
    if (!vector) return { ok: false, error: new Error("Failed to get embedding") };
    return { ok: true, value: vector };
  }

  getStats(): { apiRequestCount: number; cacheHitCount: number; cacheMissCount: number } {
    return {
      apiRequestCount: this.apiRequestCount,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
    };
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
