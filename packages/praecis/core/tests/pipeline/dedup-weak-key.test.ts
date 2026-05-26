import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { composeVector, createDefaultPipelineServices, createIngestionRuntimeFromServices } from '../../src/index.js';
import type { IDecodeStrategy, IIngestor, RawSource, Result } from '../../src/index.js';

function vector(raw: RawSource) {
  const ingestor: IIngestor = { sourceId: 'readwise', async acquire(): Promise<Result<RawSource>> { return { ok: true, value: raw }; } };
  const decode: IDecodeStrategy = {
    name: 'test',
    async decode() {
      return { ok: true, value: { segments: [{ id: 'seg-1', text: 'Weak-key corroboration must not merge resources.', locator: { kind: 'text', charStart: 0, charEnd: 47 } }], warnings: [] } };
    },
  };
  return composeVector({
    sourceId: 'readwise',
    sensitivity: 'personal',
    ingestor,
    decode: [decode],
    context: { async build() { return {}; } },
    chunking: 'token-window',
    registration: { sourceId: 'readwise', validateActiveSourceConfig: value => value },
  });
}

describe('dedup weak key runtime integration', () => {
  it('creates corroboratedBy instead of merging when only a weak key matches', async () => {
    const store = new InMemoryStore();
    await store.upsertNode('Resource', 'web:https://example.com/a', {
      label: 'Existing article',
      metadata: { canonicalId: 'web:https://example.com/a', sourceType: 'web', dedupKeys: ['content-sha256:abc'] },
    });

    const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, allowHeuristicFallback: true }));
    const readwiseVector = vector({
      canonicalId: 'readwise:book:1',
      dedupKeys: ['content-sha256:abc'],
      sourceType: 'readwise',
      sensitivity: 'personal',
      provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'readwise' },
      payload: {},
      label: 'Readwise book',
    });

    const result = await runtime.runVector(readwiseVector, { ref: 'fixture' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.dedupAction).toBe('corroborate');
    expect(result.value.resourceId).toBe('readwise:book:1');

    const edges = await store.getEdges({ subject: 'readwise:book:1', predicate: 'corroboratedBy' });
    expect(edges.ok && edges.value.items[0]?.object).toBe('web:https://example.com/a');
  });
});
