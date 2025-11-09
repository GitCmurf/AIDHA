/**
 * Evaluation harness: claim coverage assertions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import type { Result } from '../src/pipeline/types.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { LlmClaimExtractor } from '../src/extract/llm-claims.js';
import type { LlmClient, LlmCompletionRequest } from '../src/extract/llm-client.js';

class StubLlmClient implements LlmClient {
  private responses: string[];
  private index = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(_request: LlmCompletionRequest): Promise<Result<string>> {
    const response = this.responses[this.index] ?? '{"claims": []}';
    this.index += 1;
    return { ok: true, value: response };
  }
}

async function seedFixture(store: InMemoryStore, videoId: string) {
  const resourceId = `youtube-${videoId}`;
  await store.upsertNode(
    'Resource',
    resourceId,
    {
      label: `Fixture ${videoId}`,
      metadata: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      },
    },
    { detectNoop: true }
  );

  const excerpts = [
    { id: 'fixture-excerpt-0', start: 0, text: 'We define the scope and constraints for the ingestion pipeline.' },
    { id: 'fixture-excerpt-1', start: 120, text: 'The first deliverable is a stable metadata capture step for every video.' },
    { id: 'fixture-excerpt-2', start: 240, text: 'Claims should be auditable and tied to precise transcript excerpts.' },
    { id: 'fixture-excerpt-3', start: 360, text: 'Use deterministic hashing to avoid duplicate knowledge nodes.' },
    { id: 'fixture-excerpt-4', start: 480, text: 'Prioritize actionable insights over filler or repeated narration.' },
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
          duration: 8,
          sequence: index,
        },
      },
      { detectNoop: true }
    );
  }

  return { resourceId, excerptIds: excerpts.map(excerpt => excerpt.id) };
}

describe('Evaluation harness: claim coverage', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('creates claims within range and covers timeline', async () => {
    const videoId = 'fixture-video';
    const { excerptIds } = await seedFixture(store, videoId);

    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Define the ingestion scope and constraints before selecting tools.',
            excerptIds: ['fixture-excerpt-0'],
            startSeconds: 0,
            type: 'insight',
            confidence: 0.84,
            why: 'Sets the baseline objective.',
          },
          {
            text: 'Capture metadata early to anchor downstream graph operations.',
            excerptIds: ['fixture-excerpt-1'],
            startSeconds: 120,
            type: 'instruction',
            confidence: 0.78,
            why: 'Explains ordering.',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Claims must remain auditable by linking to transcript excerpts.',
            excerptIds: ['fixture-excerpt-2'],
            startSeconds: 240,
            type: 'insight',
            confidence: 0.81,
            why: 'Ensures traceability.',
          },
          {
            text: 'Deterministic hashing prevents duplicate nodes on re-ingest.',
            excerptIds: ['fixture-excerpt-3'],
            startSeconds: 360,
            type: 'fact',
            confidence: 0.79,
            why: 'Highlights idempotency.',
          },
        ],
      }),
      JSON.stringify({
        claims: [
          {
            text: 'Prioritize actionable insights over filler to keep claims useful.',
            excerptIds: ['fixture-excerpt-4'],
            startSeconds: 480,
            type: 'instruction',
            confidence: 0.77,
            why: 'Avoids low-value claims.',
          },
        ],
      }),
    ]);

    const extractor = new LlmClaimExtractor({
      client,
      model: 'fixture-model',
      promptVersion: 'v1',
      chunkMinutes: 3,
      maxChunks: 3,
      maxClaims: 8,
    });

    const pipeline = new ClaimExtractionPipeline({ graphStore: store, extractor });
    const result = await pipeline.extractClaimsForVideo(videoId, { maxClaims: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const claims = await store.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items.length).toBeGreaterThanOrEqual(5);
    expect(claims.value.items.length).toBeLessThanOrEqual(8);

    const edges = await store.getEdges({ predicate: 'claimDerivedFrom' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBeGreaterThan(0);

    const excerptSet = new Set(excerptIds);
    for (const edge of edges.value.items) {
      expect(excerptSet.has(edge.object)).toBe(true);
    }

    const excerptNodes = await store.queryNodes({ type: 'Excerpt' });
    expect(excerptNodes.ok).toBe(true);
    if (!excerptNodes.ok) return;
    const excerptStarts = excerptNodes.value.items.map(excerpt => Number(excerpt.metadata?.start ?? 0));
    const minExcerpt = Math.min(...excerptStarts);
    const maxExcerpt = Math.max(...excerptStarts);
    const range = Math.max(1, maxExcerpt - minExcerpt);

    const excerptStartMap = new Map(
      excerptNodes.value.items.map(excerpt => [excerpt.id, Number(excerpt.metadata?.start ?? 0)])
    );
    const claimStarts = edges.value.items
      .map(edge => excerptStartMap.get(edge.object))
      .filter((value): value is number => typeof value === 'number');
    expect(claimStarts.length).toBeGreaterThan(0);
    const minClaim = Math.min(...claimStarts);
    const maxClaim = Math.max(...claimStarts);

    expect(minClaim).toBeLessThanOrEqual(minExcerpt + range * 0.2);
    expect(maxClaim).toBeGreaterThanOrEqual(maxExcerpt - range * 0.2);
  });
});
