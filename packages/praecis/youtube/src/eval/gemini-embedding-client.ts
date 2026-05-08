import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../utils/io.js";
import { join } from "node:path";
import type { Result } from "../pipeline/types.js";
import { requestRateLimiterRegistry } from "./request-rate-limiter.js";
import { normalizeText } from "../extract/utils.js";
import { hashText } from "../utils/ids.js";
import { normalizeBaseUrl } from "../extract/llm-client.js";

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

const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TASK_TYPE: NonNullable<GeminiEmbeddingClientConfig["taskType"]> = "SEMANTIC_SIMILARITY";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function hashTextShort(text: string): string {
  return hashText(text).slice(0, 16);
}

function cacheKeyForText(model: string, taskType: string, outputDimensionality: number, text: string): string {
  return `${model}-${taskType}-${outputDimensionality}-${hashTextShort(text)}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) {
    throw new RangeError(`Cannot compute cosine similarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
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

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const active = signals.filter(Boolean);
  if (active.length === 1) return active[0]!;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
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
  private embeddingsComputed = 0;
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
    const configuredBatchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.batchSize = Number.isInteger(configuredBatchSize) && configuredBatchSize > 0
      ? configuredBatchSize
      : DEFAULT_BATCH_SIZE;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async similarity(textA: string, textB: string): Promise<Result<EmbeddingSimilarityScore>> {
    const embeddingA = await this.getEmbedding(textA);
    if (!embeddingA.ok) return embeddingA;
    const embeddingB = await this.getEmbedding(textB);
    if (!embeddingB.ok) return embeddingB;

    try {
      return {
        ok: true,
        value: {
          score: cosineSimilarity(embeddingA.value, embeddingB.value),
          ok: true,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async prewarm(texts: string[]): Promise<Result<{ warmed: number; failed: number }>> {
    const uniqueTexts = [...new Set(texts.map((text) => normalizeText(text)).filter(Boolean))];
    const result = await this.embedBatch(uniqueTexts);
    if (!result.ok) return result;

    return { ok: true, value: { warmed: result.value.length, failed: 0 } };
  }

  async embedBatch(texts: string[], signal?: AbortSignal): Promise<Result<number[][]>> {
    const normalized = texts.map(t => normalizeText(t));
    if (normalized.some(t => !t)) {
      return { ok: false, error: new Error("One or more texts were empty after normalization") };
    }
    const results: number[][] = Array.from({ length: normalized.length }, () => []);
    const toFetch: Array<{ text: string; index: number }> = [];

    // Check cache in parallel but process results sequentially to preserve order
    const cacheResults = await Promise.all(normalized.map((text) => {
      const cacheKey = cacheKeyForText(this.model, this.taskType, this.outputDimensionality, text);
      const cachePath = join(this.cacheDir, `${cacheKey}.json`);
      return this.readCache(cachePath, text);
    }));

    cacheResults.forEach((cached, i) => {
      if (cached) {
        results[i] = cached.vector;
        this.cacheHitCount += 1;
      } else {
        const text = normalized[i];
        if (text === undefined) return;
        toFetch.push({ text, index: i });
        this.cacheMissCount += 1;
      }
    });

    if (toFetch.length === 0) return { ok: true, value: results };

    // Batch fetch remaining
    for (let i = 0; i < toFetch.length; i += this.batchSize) {
      const chunk = toFetch.slice(i, i + this.batchSize);
      const chunkTexts = chunk.map(c => c.text);
      const batchResult = await this.embedBatchWithRetryAndSplit(chunkTexts, signal);

      if (!batchResult.ok) {
        return batchResult;
      }

      for (let j = 0; j < batchResult.value.length; j++) {
        const item = chunk[j];
        if (!item) continue;
        const vector = batchResult.value[j];
        if (vector === undefined) continue;
        results[item.index] = vector;
      }
    }

    return { ok: true, value: results };
  }

  private async embedBatchWithRetryAndSplit(texts: string[], signal?: AbortSignal): Promise<Result<number[][]>> {
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
        signal,
      }
    );

    if (!result.ok) {
      // Only split on errors that can plausibly isolate a bad item. Rate limits
      // have already exhausted retry handling in fetchWithRetry and should not
      // replay recursively.
      const errMsg = result.error.message ?? "";
      const statusMatch = /\b(\d{3})\b/.exec(errMsg);
      const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : NaN;
      const isTransient =
        (!Number.isNaN(statusCode) && statusCode >= 500 && statusCode < 600) ||
        /\btimeout\b/i.test(errMsg) ||
        errMsg.includes("ECONNRESET");
      if (!isTransient || texts.length === 1) {
        return { ok: false, error: result.error };
      }

      const mid = Math.floor(texts.length / 2);
      const left = await this.embedBatchWithRetryAndSplit(texts.slice(0, mid), signal);
      const right = await this.embedBatchWithRetryAndSplit(texts.slice(mid), signal);

      if (!left.ok || !right.ok) {
        const leftError = left.ok ? "ok" : left.error.message;
        const rightError = right.ok ? "ok" : right.error.message;
        return {
          ok: false,
          error: new Error(`Batch split failed: Left: ${leftError}, Right: ${rightError}`)
        };
      }

      return { ok: true, value: [...left.value, ...right.value] };
    }

    const json = result.value as {
      embeddings?: Array<{
        values?: number[];
      }>;
    };

    const embeddings = json.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      return {
        ok: false,
        error: new Error(`Batch embedding length mismatch: requested ${texts.length}, received ${embeddings.length}`),
      };
    }

    const values: number[][] = [];
    for (let i = 0; i < embeddings.length; i++) {
      const e = embeddings[i];
      if (!e) {
        return {
          ok: false,
          error: new Error(`Missing embedding at index ${i} in batch response`),
        };
      }
      const v = e.values;
      if (Array.isArray(v) && v.length > 0) {
        // Write to cache
        const text = texts[i];
        if (text === undefined) {
          return { ok: false, error: new Error(`Unexpected undefined text at index ${i} in batch of ${texts.length}`) };
        }
        const cacheKey = cacheKeyForText(this.model, this.taskType, this.outputDimensionality, text);
        const cachePath = join(this.cacheDir, `${cacheKey}.json`);
        try {
          await this.writeCache(cachePath, text, v);
        } catch (cacheErr) {
          // Cache write failure should not discard the successfully retrieved embedding
          console.warn(`[embedding-cache-write-failed] path=${cachePath} error=${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`);
        }
        values.push(v);
      } else {
        return {
          ok: false,
          error: new Error(`Embedding missing for item ${i} in batch of ${texts.length}`),
        };
      }
    }

    this.embeddingsComputed += values.length;

    return { ok: true, value: values };
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Result<unknown>> {
    this.apiRequestCount += 1;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const waitMs = await requestRateLimiterRegistry.waitForSlot(this.model, this.maxRequestsPerMinute);
      if (waitMs > 0) {
        // skipcq: JS-0002
        console.log(`[rate-limit-wait] model=${this.model} waitMs=${waitMs}`);
      }

      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = init.signal instanceof AbortSignal
        ? combineAbortSignals([init.signal, timeoutSignal])
        : timeoutSignal;
      try {
        const response = await fetch(url, { ...init, signal });

        if (response.ok) {
          return { ok: true, value: await response.json() };
        }

        const isRetryable = response.status === 429 || response.status >= 500;
        const errorText = await response.text();
        lastError = new Error(`Gemini API failed (${response.status}): ${errorText.slice(0, 500)}`);

        if (!isRetryable || attempt === this.maxRetries) {
          return { ok: false, error: lastError };
        }

        const retryAfter = response.headers.get("Retry-After")?.trim();
        let delayMs = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt);
        if (retryAfter) {
          if (/^\d+$/.test(retryAfter)) {
            delayMs = parseInt(retryAfter, 10) * 1000;
          } else {
            const date = Date.parse(retryAfter);
            if (!Number.isNaN(date)) {
              delayMs = date - Date.now();
            }
          }
        }

        if (!Number.isFinite(delayMs) || delayMs <= 0) {
          delayMs = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt);
        }

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
    if (!vector) {
      return { ok: false, error: new Error("Embedding result was empty for single text") };
    }
    return { ok: true, value: vector };
  }

  getApiRequestCount(): number {
    return this.apiRequestCount;
  }

  getStats(): { apiRequestCount: number; embeddingsComputed: number; cacheHitCount: number; cacheMissCount: number } {
    return {
      apiRequestCount: this.apiRequestCount,
      embeddingsComputed: this.embeddingsComputed,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
    };
  }

  private async readCache(cachePath: string, normalizedText: string): Promise<CachedEmbedding | null> {
    try {
      const raw = await readFile(cachePath, "utf-8");
      const parsed = JSON.parse(raw) as CachedEmbedding;
      if (parsed.textHash !== hashTextShort(normalizedText)) return null;
      if (!Array.isArray(parsed.vector) || parsed.vector.length === 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeCache(cachePath: string, normalizedText: string, vector: number[]): Promise<void> {
    const payload: CachedEmbedding = {
      textHash: hashTextShort(normalizedText),
      vector,
    };
    await writeFileAtomic(cachePath, JSON.stringify(payload), { sync: false });
  }
}
