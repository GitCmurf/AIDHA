import { describe, expect, it } from 'vitest';
import { InMemoryStore, LevelGraphStore, SQLiteStore, type GraphStore } from '../../src/index.js';

const stores: Array<[string, () => Promise<GraphStore>]> = [
  ['memory', async () => new InMemoryStore()],
  ['levelgraph', async () => LevelGraphStore.createInMemory()],
  ...(SQLiteStore.isAvailable() ? [['sqlite', async () => SQLiteStore.createInMemory()] as [string, () => Promise<GraphStore>]] : []),
];

describe.each(stores)('domain metadata validation on %s writes', (_name, createStore) => {
  it('rejects invalid Resource metadata', async () => {
    const store = await createStore();
    try {
      const result = await store.upsertNode('Resource', 'res-invalid', {
        label: 'Invalid',
        metadata: { sourceType: 'not-a-source' },
      });
      expect(result.ok).toBe(false);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('rejects invalid Excerpt locator metadata', async () => {
    const store = await createStore();
    try {
      const result = await store.upsertNode('Excerpt', 'excerpt-invalid', {
        label: 'Invalid',
        metadata: { locator: { kind: 'page', page: 'one', charStart: 0, charEnd: 10 } },
      });
      expect(result.ok).toBe(false);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('rejects invalid Claim confidence metadata', async () => {
    const store = await createStore();
    try {
      const result = await store.upsertNode('Claim', 'claim-invalid', {
        label: 'Invalid',
        metadata: { state: 'draft', confidence: 2 },
      });
      expect(result.ok).toBe(false);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('rejects invalid Reference URL metadata', async () => {
    const store = await createStore();
    try {
      const result = await store.upsertNode('Reference', 'ref-invalid', {
        label: 'Invalid',
        metadata: { url: 'not a url', resourceId: 'resource-1', source: 'web' },
      });
      expect(result.ok).toBe(false);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('accepts valid Reference metadata', async () => {
    const store = await createStore();
    try {
      const result = await store.upsertNode('Reference', 'ref-valid', {
        label: 'Reference',
        metadata: { url: 'https://example.com/docs', resourceId: 'resource-1', source: 'web' },
      });
      expect(result.ok).toBe(true);
    } finally {
      await store.close();
    }
  }, 60_000);
});
