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

  it('invalidates cache when prompt version or model changes', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-3');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Deterministic IDs avoid duplicate nodes across repeated ingestion runs.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            confidence: 0.8,
            type: 'insight',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Prompt changes should trigger a fresh extraction call.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            confidence: 0.8,
            type: 'insight',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Model changes should also bypass existing cache entries.',
            excerptIds: ['excerpt-4'],
            startSeconds: 120,
            confidence: 0.8,
            type: 'insight',
          },
        ],
      }),
    ]);

    const extractorV1ModelA = new LlmClaimExtractor({
      client,
      model: 'model-a',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
    });

    await extractorV1ModelA.extractClaims({ resource, excerpts, maxClaims: 5 });
    await extractorV1ModelA.extractClaims({ resource, excerpts, maxClaims: 5 });

    const extractorV2ModelA = new LlmClaimExtractor({
      client,
      model: 'model-a',
      promptVersion: 'v2',
      cacheDir,
      chunkMinutes: 10,
    });
    await extractorV2ModelA.extractClaims({ resource, excerpts, maxClaims: 5 });

    const extractorV2ModelB = new LlmClaimExtractor({
      client,
      model: 'model-b',
      promptVersion: 'v2',
      cacheDir,
      chunkMinutes: 10,
    });
    await extractorV2ModelB.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(client.calls).toBe(3);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('invalidates cache when transcript hash changes', async () => {
    const seeded = await seedVideo(store, 'llm-video-4');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Hash transcript content to make cache keys deterministic.',
            excerptIds: ['excerpt-1'],
            startSeconds: 0,
            confidence: 0.85,
            type: 'instruction',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Modified transcript content should trigger a fresh extraction.',
            excerptIds: ['excerpt-1'],
            startSeconds: 0,
            confidence: 0.86,
            type: 'instruction',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
    });

    await extractor.extractClaims({ resource: seeded.resource, excerpts: seeded.excerpts, maxClaims: 5 });

    const excerptNode = await store.getNode('excerpt-1');
    expect(excerptNode.ok).toBe(true);
    if (!excerptNode.ok || !excerptNode.value) return;
    await store.upsertNode(
      'Excerpt',
      excerptNode.value.id,
      {
        label: excerptNode.value.label,
        content: `${excerptNode.value.content ?? ''} Additional detail for hash change.`,
        metadata: excerptNode.value.metadata,
      },
      { detectNoop: true }
    );

    const updatedExcerpts = await store.queryNodes({
      type: 'Excerpt',
      filters: { resourceId: 'youtube-llm-video-4' },
    });
    expect(updatedExcerpts.ok).toBe(true);
    if (!updatedExcerpts.ok) return;

    await extractor.extractClaims({
      resource: seeded.resource,
      excerpts: updatedExcerpts.value.items,
      maxClaims: 5,
    });

    expect(client.calls).toBe(2);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('deterministically edits and deduplicates candidates', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-5');
    const cacheDirA = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const cacheDirB = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));

    const claimsSet = [
      {
        text: 'Deterministic IDs prevent duplicate knowledge items during repeated ingestion runs.',
        excerptIds: ['excerpt-2'],
        startSeconds: 30,
        type: 'insight',
        confidence: 0.55,
      },
      {
        text: 'Repeated ingestion stays idempotent when deterministic IDs are used for knowledge items.',
        excerptIds: ['excerpt-2'],
        startSeconds: 30,
        type: 'insight',
        confidence: 0.92,
      },
      {
        text: 'Hashing stable fields with SHA-256 gives repeatable identifiers across sessions.',
        excerptIds: ['excerpt-3'],
        startSeconds: 70,
        type: 'instruction',
        confidence: 0.75,
      },
      {
        text: 'Capture only actionable points and keep evidence snippets concise for clean dossiers.',
        excerptIds: ['excerpt-4'],
        startSeconds: 120,
        type: 'instruction',
        confidence: 0.74,
      },
    ];

    const clientA = new StubLlmClient([JSON.stringify({ claims: claimsSet })]);
    const clientB = new StubLlmClient([JSON.stringify({ claims: [...claimsSet].reverse() })]);

    const extractorA = new LlmClaimExtractor({
      client: clientA,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir: cacheDirA,
      chunkMinutes: 10,
      maxClaims: 10,
    });
    const extractorB = new LlmClaimExtractor({
      client: clientB,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir: cacheDirB,
      chunkMinutes: 10,
      maxClaims: 10,
    });

    const resultA = await extractorA.extractClaims({ resource, excerpts, maxClaims: 10 });
    const resultB = await extractorB.extractClaims({ resource, excerpts, maxClaims: 10 });

    expect(resultA.length).toBe(3);
    expect(resultA.map(claim => claim.text)).toEqual(resultB.map(claim => claim.text));
    expect(resultA[0]?.text).toContain('idempotent');
    expect(resultA[1]?.text).toContain('SHA-256');

    await rm(cacheDirA, { recursive: true, force: true });
    await rm(cacheDirB, { recursive: true, force: true });
  });
});
