import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GeminiEmbeddingClient } from "../../src/eval/gemini-embedding-client.js";

describe("GeminiEmbeddingClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("embeds texts once and reuses the cache for repeat similarity checks", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [{ values: [1, 0, 0] }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [{ values: [1, 0, 0] }] }),
      } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      timeoutMs: 1000,
    });

    const first = await client.similarity("alpha claim", "beta claim");
    const second = await client.similarity("alpha claim", "beta claim");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok) expect(first.value.score).toBeCloseTo(1, 5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"
    );

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("prewarms unique texts without refetching duplicates", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [
            { values: [1, 0, 0] },
            { values: [0, 1, 0] },
            { values: [0, 0, 1] }
          ]
        }),
      } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      timeoutMs: 1000,
    });

    const result = await client.prewarm([
      "alpha claim",
      "alpha claim",
      "beta claim",
      "  beta   claim  ",
      "gamma claim",
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warmed).toBe(3);
      expect(result.value.failed).toBe(0);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("embedBatch issues a single batchEmbedContents call for uncached items", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [{ values: [1, 0] }, { values: [0, 1] }],
      }),
    } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
    });

    const result = await client.embedBatch(["item1", "item2"]);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(":batchEmbedContents");
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.requests).toHaveLength(2);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("embedBatch isolates failures by splitting batches on transient HTTP 503", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service temporarily unavailable",
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [{ values: [1, 0] }],
        }),
      } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      maxRetries: 0,
    });

    const result = await client.embedBatch(["item1", "item2"]);

    expect(result.ok).toBe(true);
    // 1 failed batch (2 items) -> 2 successful single items
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("embedBatch does not split on non-transient errors like HTTP 400", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Batch too large or invalid",
      } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
    });

    const result = await client.embedBatch(["item1", "item2"]);

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("uses a configured embedding model override when provided", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [{ values: [1, 0, 0] }] }),
      } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      model: "gemini-embedding-002",
    });

    const result = await client.getEmbedding("alpha claim");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-002:batchEmbedContents"
    );

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("retries on HTTP 429 and succeeds on second attempt", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));

    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          // Retry-After: 0 so the retry fires with zero real-time delay
          headers: new Headers({ "Retry-After": "0" }),
          text: async () => "Rate limit exceeded",
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ embeddings: [{ values: [1, 0, 0] }] }),
      } as Response;
    });

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
    });

    const result = await client.getEmbedding("test retry");

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("getEmbeddings returns error if a batch fails completely", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      maxRetries: 0,
    });

    const result = await client.embedBatch(["item1", "item2"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Gemini API failed (500)");
    }

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("getEmbeddings returns error if API returns 200 OK but missing embeddings", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: [
          { values: [0.1, 0.2] },
          {} // Missing values
        ]
      }),
    } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      maxRetries: 0,
    });

    const result = await client.embedBatch(["item1", "item2"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Embedding missing for item 1");
    }

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("getEmbeddings returns error if API returns 200 OK but length mismatch", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: [
          { values: [0.1, 0.2] }
        ]
      }),
    } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      maxRetries: 0,
    });

    const result = await client.embedBatch(["item1", "item2"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Batch embedding length mismatch");
    }

    await rm(cacheDir, { recursive: true, force: true });
  });
});
