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
        json: async () => ({ embedding: { values: [1, 0, 0] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: [1, 0, 0] } }),
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent"
    );

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("prewarms unique texts without refetching duplicates", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: [1, 0, 0] } }),
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
    ], 2);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warmed).toBe(3);
      expect(result.value.failed).toBe(0);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("uses a configured embedding model override when provided", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "aidha-gemini-embed-"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: [1, 0, 0] } }),
      } as Response);

    const client = new GeminiEmbeddingClient({
      apiKey: "test-key", // pragma: allowlist secret
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cacheDir,
      timeoutMs: 1000,
      model: "gemini-embedding-002",
    });

    const result = await client.getEmbedding("alpha claim");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-002:embedContent"
    );

    await rm(cacheDir, { recursive: true, force: true });
  });
});
