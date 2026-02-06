/**
 * LLM claim extraction tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore } from '@aidha/graph-backend';
import type { Result } from '../src/pipeline/types.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import type { LlmClient, LlmCompletionRequest } from '../src/extract/llm-client.js';
import { LlmClaimExtractor } from '../src/extract/llm-claims.js';

class StubLlmClient implements LlmClient {
  calls = 0;
  private responses: string[];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(request: LlmCompletionRequest): Promise<Result<string>> {
    const response = this.responses[this.calls] ?? '{"claims": []}';
    this.calls += 1;
    void request;
    return { ok: true, value: response };
  }
}

async function seedVideo(store: InMemoryStore, videoId: string) {
  const resourceId = `youtube-${videoId}`;
  await store.upsertNode(
    'Resource',
    resourceId,
    {
      label: `Video ${videoId}`,
      metadata: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      },
    },
    { detectNoop: true }
  );

  const excerpts = [
    { id: 'excerpt-1', start: 0, text: 'We define the problem and outline constraints.' },
    { id: 'excerpt-2', start: 30, text: 'The core claim: deterministic IDs prevent duplicates.' },
    { id: 'excerpt-3', start: 70, text: 'Implementation detail: use SHA-256 on stable fields.' },
    { id: 'excerpt-4', start: 120, text: 'Avoid sponsor content and keep only actionable points.' },
  ];

  for (const [index, excerpt] of excerpts.entries()) {
    await store.upsertNode(
      'Excerpt',
      excerpt.id,
      {
        label: `Excerpt ${videoId} #${index + 1}`,
        content: excerpt.text,
        metadata: {
          resourceId,
          videoId,
          start: excerpt.start,
          duration: 5,
          sequence: index,
        },
      },
      { detectNoop: true }
    );
  }

  const resource = await store.getNode(resourceId);
  const excerptResults = await store.queryNodes({ type: 'Excerpt', filters: { resourceId } });
  if (!resource.ok || !resource.value) throw resource.error ?? new Error('Missing resource');
  if (!excerptResults.ok) throw excerptResults.error ?? new Error('Missing excerpts');

  return { resource: resource.value, excerpts: excerptResults.value.items };
}

describe('LLM claim extraction', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('caches LLM responses per chunk', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Deterministic IDs prevent duplicate knowledge items.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            type: 'insight',
            confidence: 0.82,
            why: 'Explains the benefit of hashing.',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Use SHA-256 on stable fields for repeatable IDs.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'instruction',
            confidence: 0.76,
            why: 'Gives an implementation detail.',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 1,
      maxChunks: 3,
    });

    const first = await extractor.extractClaims({ resource, excerpts, maxClaims: 3 });
    const second = await extractor.extractClaims({ resource, excerpts, maxClaims: 3 });

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    expect(client.calls).toBe(2);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('persists LLM metadata on stored claims', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-2');
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Stable hashes make ingestion idempotent across runs.',
            excerptIds: ['excerpt-1', 'excerpt-2'],
            startSeconds: 0,
            type: 'insight',
            confidence: 0.9,
            why: 'Captures the core concept.',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      chunkMinutes: 10,
    });

    const pipeline = new ClaimExtractionPipeline({ graphStore: store, extractor });
    const result = await pipeline.extractClaimsForVideo('llm-video-2', { maxClaims: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const claims = await store.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items.length).toBe(1);
    const claim = claims.value.items[0];
    expect(claim?.metadata?.method).toBe('llm');
    expect(claim?.metadata?.model).toBe('test-model');
    expect(claim?.metadata?.promptVersion).toBe('v1');
  });
});
