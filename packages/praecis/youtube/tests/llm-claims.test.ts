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
import { HeuristicClaimExtractor } from '../src/extract/claims.js';

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

  async complete(request: any): Promise<any> {
    const result = await this.generate(request);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, text: result.value };
  }
}

class SequenceStubLlmClient implements LlmClient {
  calls = 0;

  constructor(private readonly responses: Array<Result<string>>) {}

  async generate(request: LlmCompletionRequest): Promise<Result<string>> {
    void request;
    const response = this.responses[this.calls] ?? { ok: true, value: '{"claims":[]}' };
    this.calls += 1;
    return response;
  }

  async complete(request: any): Promise<any> {
    const result = await this.generate(request);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, text: result.value };
  }
}

class RecordingStubLlmClient implements LlmClient {
  calls = 0;
  requests: LlmCompletionRequest[] = [];

  constructor(private readonly responses: string[]) {}

  async generate(request: LlmCompletionRequest): Promise<Result<string>> {
    this.requests.push(request);
    const response = this.responses[this.calls] ?? '{"claims": []}';
    this.calls += 1;
    return { ok: true, value: response };
  }

  async complete(request: any): Promise<any> {
    const result = await this.generate(request);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, text: result.value };
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

  it('does not record valid empty claim sets as circuit-breaker failures', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-empty-ok');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient(['{"claims": []}']);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
      circuitBreaker: {
        failureThreshold: 2,
        resetTimeoutMs: 1000,
      },
    });

    const result = await extractor.extractClaims({ excerpts, resourceId: resource.id, maxClaims: 10 });

    expect(result).toEqual([]);
    expect(client.calls).toBe(2);
    expect((extractor as any).circuitBreaker.getStats().failures).toBe(0);


    await rm(cacheDir, { recursive: true, force: true });
  });

  it('clears stale LLM run metadata when a later run has no model, prompt, or diagnostics', async () => {
    const resourceId = 'youtube-metadata-clear';
    await store.upsertNode(
      'Resource',
      resourceId,
      {
        label: 'Metadata Clear Video',
        metadata: {
          videoId: 'metadata-clear',
          url: 'https://www.youtube.com/watch?v=metadata-clear',
        },
      },
      { detectNoop: true }
    );

    const excerptFixtures = [
      { id: 'meta-excerpt-1', start: 0, text: 'Deterministic identifiers prevent duplicate claim nodes across repeated ingestion runs.' },
      { id: 'meta-excerpt-2', start: 30, text: 'Stable field hashing keeps provenance and timestamps aligned for every extracted assertion.' },
    ];

    for (const [index, excerpt] of excerptFixtures.entries()) {
      await store.upsertNode(
        'Excerpt',
        excerpt.id,
        {
          label: `Excerpt metadata-clear #${index + 1}`,
          content: excerpt.text,
          metadata: {
            resourceId,
            videoId: 'metadata-clear',
            start: excerpt.start,
            duration: 5,
            sequence: index,
          },
        },
        { detectNoop: true }
      );
    }

    const llmExtractor = new LlmClaimExtractor({
      client: new StubLlmClient([
        JSON.stringify({
          claims: [
            {
              text: 'Deterministic identifiers prevent duplicate claim nodes across repeated ingestion runs.',
              excerptIds: ['meta-excerpt-1'],
              startSeconds: 0,
              type: 'insight',
              confidence: 0.9,
            },
          ],
        }),
      ]),
      model: 'test-model',
      promptVersion: 'v1',
      chunkMinutes: 10,
    });

    const llmPipeline = new ClaimExtractionPipeline({ graphStore: store, extractor: llmExtractor });
    const llmResult = await llmPipeline.extractClaimsForVideo('metadata-clear', { maxClaims: 5 });
    expect(llmResult.ok).toBe(true);

    const afterLlm = await store.getNode(resourceId);
    expect(afterLlm.ok).toBe(true);
    if (!afterLlm.ok || !afterLlm.value) return;
    expect(afterLlm.value.metadata?.['lastClaimRunModel']).toBe('test-model');
    expect(afterLlm.value.metadata?.['lastClaimRunPromptVersion']).toBe('v1');
    expect(afterLlm.value.metadata?.['lastClaimRunEditorDiagnostics']).toBeTypeOf('string');

    const heuristicPipeline = new ClaimExtractionPipeline({
      graphStore: store,
      extractor: new HeuristicClaimExtractor(),
    });
    const heuristicResult = await heuristicPipeline.extractClaimsForVideo('metadata-clear', { maxClaims: 5 });
    expect(heuristicResult.ok).toBe(true);

    const afterHeuristic = await store.getNode(resourceId);
    expect(afterHeuristic.ok).toBe(true);
    if (!afterHeuristic.ok || !afterHeuristic.value) return;
    expect(afterHeuristic.value.metadata?.['lastClaimRunModel']).toBeUndefined();
    expect(afterHeuristic.value.metadata?.['lastClaimRunPromptVersion']).toBeUndefined();
    expect(afterHeuristic.value.metadata?.['lastClaimRunEditorDiagnostics']).toBeTypeOf('string');
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

  it('does not fall back to legacy cache entries when custom tuning is enabled', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-custom-cache');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));

    const extractorDefault = new LlmClaimExtractor({
      client: new StubLlmClient([
        JSON.stringify({
          claims: [
            {
              text: 'Default cached claim should not be reused for custom tuning.',
              excerptIds: ['excerpt-2'],
              startSeconds: 30,
              confidence: 0.8,
              type: 'insight',
            },
          ],
        }),
      ]),
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
    });

    await extractorDefault.extractClaims({ resource, excerpts, maxClaims: 5 });

    const clientCustom = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Custom tuning should bypass legacy cache fallback.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            confidence: 0.82,
            type: 'instruction',
          },
        ],
      }),
    ]);

    const extractorCustom = new LlmClaimExtractor({
      client: clientCustom,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
      reasoningEffort: 'high',
    });

    const result = await extractorCustom.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(clientCustom.calls).toBe(1);
    expect(result[0]?.text).toContain('Custom tuning');
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

  it('rewrites selected claims with cache and guardrails', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-6');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Use SHA-256 with 3 stable fields to generate deterministic IDs across reruns.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'instruction',
            confidence: 0.88,
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            index: 0,
            text: 'Use SHA-256 on 3 stable fields to produce deterministic IDs across reruns.',
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
      maxClaims: 10,
      editorLlm: true,
    });

    const first = await extractor.extractClaims({ resource, excerpts, maxClaims: 10 });
    const second = await extractor.extractClaims({ resource, excerpts, maxClaims: 10 });

    expect(first.length).toBe(1);
    expect(first[0]?.text).toContain('on 3 stable fields');
    expect(second[0]?.text).toBe(first[0]?.text);
    expect(client.calls).toBe(2);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('keeps original claim when rewrite violates numeric preservation guard', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-7');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Use SHA-256 with 3 stable fields to generate deterministic IDs across reruns.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'instruction',
            confidence: 0.88,
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            index: 0,
            text: 'Use SHA-256 on stable fields to produce deterministic IDs.',
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
      maxClaims: 10,
      editorLlm: true,
    });

    const selected = await extractor.extractClaims({ resource, excerpts, maxClaims: 10 });
    expect(selected.length).toBe(1);
    expect(selected[0]?.text).toContain('with 3 stable fields');

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('keeps original claim when rewrite violates keyword overlap guard', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-8');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Use SHA-256 with 3 stable fields to generate deterministic IDs across reruns.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'instruction',
            confidence: 0.88,
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            index: 0,
            text: 'Completely unrelated meteorology commentary with no overlap at all.',
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
      maxClaims: 10,
      editorLlm: true,
      editorRewriteMinKeywordOverlap: 0.3,
    });

    const selected = await extractor.extractClaims({ resource, excerpts, maxClaims: 10 });
    expect(selected.length).toBe(1);
    expect(selected[0]?.text).toContain('with 3 stable fields');

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('keeps original claim when rewrite exceeds edit ratio guard', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-video-9');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Use SHA-256 with 3 stable fields to generate deterministic IDs across reruns.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'instruction',
            confidence: 0.88,
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            index: 0,
            text: 'IDs across reruns need deterministic hashing while also adding extra details now.',
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
      maxClaims: 10,
      editorLlm: true,
      editorRewriteMaxEditRatio: 0.4,
    });

    const selected = await extractor.extractClaims({ resource, excerpts, maxClaims: 10 });
    expect(selected.length).toBe(1);
    expect(selected[0]?.text).toContain('with 3 stable fields');

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('retries transient provider failures before succeeding', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-retry-ok');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-retry-cache-'));
    const client = new SequenceStubLlmClient([
      { ok: false, error: new Error('Gemini request failed (503): high demand') },
      {
        ok: true,
        value: JSON.stringify({
          claims: [
            {
              text: 'Deterministic IDs prevent duplicate knowledge items.',
              excerptIds: ['excerpt-2'],
              startSeconds: 30,
              type: 'insight',
            },
          ],
        }),
      },
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
      transportRetry: { maxAttempts: 2, baseDelayMs: 1 },
    });

    const claims = await extractor.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(claims).toHaveLength(1);
    expect(client.calls).toBe(2);
    expect(extractor.getLastRunStats().transportRetryCount).toBe(1);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('supports semantic-overlap chunking for eval-style extraction', async () => {
    const resource = {
      id: 'youtube-llm-semantic-chunks',
      metadata: { videoId: 'llm-semantic-chunks' },
    } as any;
    const excerpts = [
      {
        id: 'excerpt-a',
        content: 'We define the problem carefully. The first substantive claim is that stable identifiers prevent duplicate graph writes across repeated ingestion runs. '.repeat(8),
        metadata: { start: 0 },
      },
      {
        id: 'excerpt-b',
        content: 'The implementation detail is specific. Use a deterministic SHA-256 hash over canonical fields so replaying the same transcript yields the same identifier again. '.repeat(8),
        metadata: { start: 40 },
      },
      {
        id: 'excerpt-c',
        content: 'A related claim follows naturally. Semantic chunking should respect discourse boundaries so a sentence introducing a mechanism is not detached from the sentence that explains it. '.repeat(8),
        metadata: { start: 90 },
      },
      {
        id: 'excerpt-d',
        content: 'Finally the speaker gives an operational recommendation. Keep overlap small but deliberate so adjacent chunks retain enough context without duplicating the whole section. '.repeat(8),
        metadata: { start: 140 },
      },
    ] as any;
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-semantic-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'First chunk claim.',
            excerptIds: ['excerpt-a'],
            startSeconds: 0,
            type: 'fact',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Second chunk claim.',
            excerptIds: ['excerpt-d'],
            startSeconds: 140,
            type: 'fact',
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
      chunkStrategy: 'semantic-overlap',
      chunkTargetInputTokens: 200,
      chunkOverlapExcerpts: 1,
    });

    const claims = await extractor.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(client.calls).toBeGreaterThan(1);
    expect(Array.isArray(claims)).toBe(true);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('records chunk token diagnostics even when chunk responses come from cache', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-cache-diagnostics');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-cache-diagnostics-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Cached diagnostic claim preserves enough detail to survive editorial filtering.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            type: 'insight',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkStrategy: 'semantic-overlap',
      chunkTargetInputTokens: 200,
      chunkHardMaxInputTokens: 400,
      chunkOverlapExcerpts: 0,
    });

    await extractor.extractClaims({ resource, excerpts, maxClaims: 3 });
    const second = await extractor.extractClaims({ resource, excerpts, maxClaims: 3 });

    expect(second.length).toBeGreaterThan(0);
    expect(extractor.getLastRunStats().maxChunkInputTokens).toBeGreaterThan(0);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('supports whole-transcript chunking as a single extraction pass', async () => {
    const resource = {
      id: 'youtube-llm-whole-transcript',
      metadata: { videoId: 'llm-whole-transcript' },
    } as any;
    const excerpts = [
      { id: 'excerpt-a', content: 'Alpha claim. '.repeat(40), metadata: { start: 0 } },
      { id: 'excerpt-b', content: 'Beta claim. '.repeat(40), metadata: { start: 40 } },
      { id: 'excerpt-c', content: 'Gamma claim. '.repeat(40), metadata: { start: 80 } },
    ] as any;
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-whole-transcript-'));
    const client = new StubLlmClient([
      '{"claims":[{"text":"Whole transcript claim preserves the main point across the entire transcript context.","excerptIds":["excerpt-a"],"type":"fact"}]}',
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkStrategy: 'whole-transcript',
    });

    const claims = await extractor.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(client.calls).toBe(1);
    expect(claims).toHaveLength(1);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('runs a single self-improvement round when enabled', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-self-improve');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-self-improve-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Deterministic IDs prevent duplicate claim nodes across repeated ingestion runs.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            type: 'insight',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Deterministic IDs prevent duplicate claim nodes across repeated ingestion runs.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            type: 'insight',
          },
          {
            text: 'Stable field hashing provides the broader implementation mechanism behind duplicate prevention.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'mechanism',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1:self-improve',
      cacheDir,
      selfImproveMaxRounds: 1,
    });

    const claims = await extractor.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(client.calls).toBe(2);
    expect(claims).toHaveLength(2);
    expect(extractor.getLastRunStats().selfImproveRoundCount).toBe(1);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('includes teacher-gap guidance in the self-improvement prompt when provided', async () => {
    const { resource, excerpts } = await seedVideo(store, 'llm-self-improve-guided');
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-self-improve-guided-'));
    const client = new RecordingStubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Deterministic IDs prevent duplicate claim nodes across repeated ingestion runs.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            type: 'insight',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Deterministic IDs prevent duplicate claim nodes across repeated ingestion runs.',
            excerptIds: ['excerpt-2'],
            startSeconds: 30,
            type: 'insight',
          },
          {
            text: 'Stable field hashing is the broader implementation mechanism behind duplicate prevention.',
            excerptIds: ['excerpt-3'],
            startSeconds: 70,
            type: 'mechanism',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1:self-improve-guided',
      cacheDir,
      selfImproveMaxRounds: 1,
      selfImproveGuidance: {
        teacherCandidateId: 'manual/GG',
        focusAreas: ['Add a clear root claim.', 'Preserve explicit frameworks.'],
        missingTeacherClaims: ['Five layouts cover 90% of slides.'],
        extraCandidateClaims: ['Overly narrow duplicate claim.'],
      },
    });

    await extractor.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(client.calls).toBe(2);
    expect(client.requests[1]?.user).toContain('TEACHER_GUIDANCE_JSON');
    expect(client.requests[1]?.user).toContain('manual/GG');
    expect(client.requests[1]?.user).toContain('Five layouts cover 90% of slides.');
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('runs one bounded prompt-pack retry when structural diagnostics indicate missing root coverage', async () => {
    const store = new InMemoryStore();
    const resourceId = 'youtube-llm-router-retry';
    await store.upsertNode(
      'Resource',
      resourceId,
      {
        label: 'Consulting slide layouts',
        metadata: {
          videoId: 'llm-router-retry',
          topicDomain: 'Business Strategy',
        },
      },
      { detectNoop: true }
    );
    const excerpts = [
      { id: 'retry-1', start: 0, text: 'There are five slide layouts used in consulting presentations.' },
      { id: 'retry-2', start: 30, text: 'Chart slides and table slides are two of the layouts.' },
    ];
    for (const [index, excerpt] of excerpts.entries()) {
      await store.upsertNode(
        'Excerpt',
        excerpt.id,
        {
          label: `Retry Excerpt ${index + 1}`,
          content: excerpt.text,
          metadata: { resourceId, videoId: 'llm-router-retry', start: excerpt.start, duration: 5, sequence: index },
        },
        { detectNoop: true }
      );
    }

    const resource = (await store.getNode(resourceId)).value!;
    const excerptNodes = (await store.queryNodes({ type: 'Excerpt', filters: { resourceId } })).value.items;
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-router-retry-'));
    const client = new RecordingStubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Chart slides should match the underlying data type and decision context.',
            excerptIds: ['retry-2'],
            startSeconds: 30,
            type: 'fact',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Five slide layouts account for most consulting presentation needs.',
            excerptIds: ['retry-1'],
            startSeconds: 0,
            type: 'insight',
          },
          {
            text: 'Chart slides and table slides are two of the core layout categories.',
            excerptIds: ['retry-2'],
            startSeconds: 30,
            type: 'fact',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'pass1-claim-mining-v2',
      cacheDir,
      promptPackId: 'business-framework',
      enablePromptRouting: false,
    });

    const claims = await extractor.extractClaims({ resource, excerpts: excerptNodes, maxClaims: 5 });
    const stats = extractor.getLastRunStats();

    expect(client.calls).toBe(2);
    expect(claims[0]?.text).toContain('Five slide layouts');
    expect(stats.retryTriggered).toBe(true);
    expect(stats.retryPromptPackId).toBe('enumeration-framework-v2');
    await rm(cacheDir, { recursive: true, force: true });
    await store.close();
  });

  it('enforces a hard max token split for semantic-overlap chunking', async () => {
    const resource = {
      id: 'youtube-llm-hard-max',
      metadata: { videoId: 'llm-hard-max' },
    } as any;
    const excerpts = [
      {
        id: 'excerpt-a',
        content: 'Alpha claim with many repeated tokens to force chunk growth. '.repeat(40),
        metadata: { start: 0 },
      },
      {
        id: 'excerpt-b',
        content: 'Beta claim with many repeated tokens to force another split when the hard max is low. '.repeat(40),
        metadata: { start: 30 },
      },
      {
        id: 'excerpt-c',
        content: 'Gamma claim continues the pattern and should trigger a further chunk if the cap is respected. '.repeat(40),
        metadata: { start: 60 },
      },
    ] as any;
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-hard-max-cache-'));
    const client = new StubLlmClient([
      '{"claims":[{"text":"Chunk 1","excerptIds":["excerpt-a"],"type":"fact"}]}',
      '{"claims":[{"text":"Chunk 2","excerptIds":["excerpt-b"],"type":"fact"}]}',
      '{"claims":[{"text":"Chunk 3","excerptIds":["excerpt-c"],"type":"fact"}]}',
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'v1',
      cacheDir,
      chunkStrategy: 'semantic-overlap',
      chunkTargetInputTokens: 120,
      chunkHardMaxInputTokens: 150,
      chunkOverlapExcerpts: 0,
    });

    await extractor.extractClaims({ resource, excerpts, maxClaims: 5 });

    expect(client.calls).toBeGreaterThan(1);
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('does not downgrade an explicitly configured v2 prompt pack via retry routing', async () => {
    const resource = {
      id: 'youtube-llm-v2-pack',
      label: 'Lp(a) clinical discussion',
      metadata: { videoId: 'llm-v2-pack', topicDomain: 'Clinical cardiology' },
    } as any;
    const excerptNodes = [
      {
        id: 'excerpt-1',
        content: 'Lipoprotein(a) is genetically determined and increases cardiovascular risk. There are four principles that guide management.',
        metadata: { start: 0 },
      },
    ] as any;
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-llm-v2-pack-cache-'));
    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Lipoprotein(a) is genetically determined and raises cardiovascular risk.',
            excerptIds: ['excerpt-1'],
            startSeconds: 0,
            type: 'fact',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'test-model',
      promptVersion: 'pass1-claim-mining-v2',
      cacheDir,
      promptPackId: 'clinical-risk-management-v2',
      enablePromptRouting: false,
    });

    await extractor.extractClaims({ resource, excerpts: excerptNodes, maxClaims: 5 });
    const stats = extractor.getLastRunStats();

    expect(client.calls).toBe(1);
    expect(stats.promptPackId).toBe('clinical-risk-management-v2');
    expect(stats.retryTriggered).toBe(false);
    expect(stats.retryPromptPackId).toBeUndefined();
    await rm(cacheDir, { recursive: true, force: true });
  });
});
