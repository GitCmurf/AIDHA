import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import type { GraphStore } from '@aidha/graph-backend';
import { applyDedupResolution } from '../../src/compose/dedup-link.js';
import type { RawSource } from '../../src/types/index.js';

function makeSource(overrides: Partial<RawSource> & Pick<RawSource, 'canonicalId' | 'sourceType'>): RawSource {
  return {
    canonicalId: overrides.canonicalId,
    dedupKeys: overrides.dedupKeys,
    sourceType: overrides.sourceType,
    sensitivity: overrides.sensitivity ?? 'public',
    provenance: overrides.provenance ?? {
      sourceUri: overrides.canonicalId,
      ingestedAt: '2026-05-22T00:00:00.000Z',
      sourceType: overrides.sourceType,
    },
    payload: overrides.payload ?? {},
    label: overrides.label ?? overrides.canonicalId,
  };
}

async function seedResource(store: GraphStore, source: RawSource): Promise<void> {
  await store.upsertNode('Resource', source.canonicalId, {
    label: source.label,
    metadata: {
      canonicalId: source.canonicalId,
      sourceType: source.sourceType,
      dedupKeys: source.dedupKeys ?? [],
      provenances: [source.provenance],
    },
  });
}

describe('applyDedupResolution', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('merges same-canonical RSS arrivals into the existing web resource', async () => {
    const web = makeSource({
      canonicalId: 'web:https://example.com/article',
      sourceType: 'web',
      dedupKeys: ['web:https://example.com/article', 'https://example.com/article'],
      provenance: {
        sourceUri: 'https://example.com/article',
        ingestedAt: '2026-05-22T00:00:00.000Z',
        sourceType: 'web',
      },
      label: 'Example article',
    });
    await seedResource(store, web);

    const rss = makeSource({
      canonicalId: 'web:https://example.com/article',
      sourceType: 'rss',
      dedupKeys: ['https://blog.example.com/feed.xml', 'https://example.com/article', 'item-1'],
      provenance: {
        sourceUri: 'https://blog.example.com/feed.xml',
        ingestedAt: '2026-05-22T01:00:00.000Z',
        sourceType: 'rss',
      },
      label: 'Example article',
    });

    const result = await applyDedupResolution(store, rss);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('merge');
    expect(result.value.resourceId).toBe(web.canonicalId);
    expect(result.value.edgeCreated).toBe(false);

    const nodeResult = await store.getNode(web.canonicalId);
    expect(nodeResult.ok).toBe(true);
    if (!nodeResult.ok || !nodeResult.value) return;
    const metadata = nodeResult.value.metadata as Record<string, unknown>;
    const provenances = metadata.provenances as Array<Record<string, unknown>>;
    const dedupKeys = metadata.dedupKeys as string[];
    expect(provenances).toHaveLength(2);
    expect(dedupKeys).toContain('https://blog.example.com/feed.xml');
    expect(dedupKeys).toContain('item-1');

    const edges = await store.getEdges({ subject: web.canonicalId, predicate: 'alsoSeenVia' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items).toHaveLength(0);
  });

  it('adds alsoSeenVia when a strong dedup key merges a different canonical id', async () => {
    const web = makeSource({
      canonicalId: 'web:https://example.com/article',
      sourceType: 'web',
      dedupKeys: ['web:https://example.com/article'],
      provenance: {
        sourceUri: 'https://example.com/article',
        ingestedAt: '2026-05-22T00:00:00.000Z',
        sourceType: 'web',
      },
    });
    await seedResource(store, web);

    const rss = makeSource({
      canonicalId: 'rss:https://blog.example.com/feed.xml#item-1',
      sourceType: 'rss',
      dedupKeys: ['web:https://example.com/article', 'https://example.com/article'],
      provenance: {
        sourceUri: 'https://blog.example.com/feed.xml',
        ingestedAt: '2026-05-22T01:00:00.000Z',
        sourceType: 'rss',
      },
    });

    const result = await applyDedupResolution(store, rss);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('merge');
    expect(result.value.edgeCreated).toBe(true);

    const edges = await store.getEdges({ subject: web.canonicalId, predicate: 'alsoSeenVia' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items).toHaveLength(1);
    expect(edges.value.items[0]?.object).toBe(rss.canonicalId);
  });

  it('corroborates weak matches without merging into the existing resource', async () => {
    const web = makeSource({
      canonicalId: 'web:https://example.com/article',
      sourceType: 'web',
      dedupKeys: ['content-sha256:weak-123'],
      provenance: {
        sourceUri: 'https://example.com/article',
        ingestedAt: '2026-05-22T00:00:00.000Z',
        sourceType: 'web',
      },
    });
    await seedResource(store, web);

    const readwise = makeSource({
      canonicalId: 'readwise:highlight:1',
      sourceType: 'readwise',
      dedupKeys: ['content-sha256:weak-123'],
      provenance: {
        sourceUri: 'https://readwise.io/highlights/1',
        ingestedAt: '2026-05-22T01:00:00.000Z',
        sourceType: 'readwise',
      },
    });

    const result = await applyDedupResolution(store, readwise);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('corroborate');
    expect(result.value.resourceId).toBe(readwise.canonicalId);
    expect(result.value.edgeCreated).toBe(true);

    const edgeResult = await store.getEdges({ subject: readwise.canonicalId, predicate: 'corroboratedBy' });
    expect(edgeResult.ok).toBe(true);
    if (!edgeResult.ok) return;
    expect(edgeResult.value.items).toHaveLength(1);
    expect(edgeResult.value.items[0]?.object).toBe(web.canonicalId);
  });
});
