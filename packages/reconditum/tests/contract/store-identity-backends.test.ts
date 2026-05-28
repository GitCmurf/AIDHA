import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStore, LevelGraphStore, SQLiteStore, type GraphStore } from '../../src/index.js';

const stores: Array<[string, () => Promise<GraphStore>]> = [
  ['memory', async () => new InMemoryStore()],
  ['levelgraph', async () => LevelGraphStore.createInMemory()],
  ...(SQLiteStore.isAvailable() ? [['sqlite', async () => SQLiteStore.createInMemory()] as [string, () => Promise<GraphStore>]] : []),
];

describe.each(stores)('findResourceByIdentity on %s', (_name, createStore) => {
  let store: GraphStore;

  afterEach(async () => {
    await store?.close();
  });

  it('matches Resource canonicalId and dedupKeys', async () => {
    store = await createStore();
    await store.upsertNode('Resource', 'res-1', {
      label: 'Resource',
      metadata: { canonicalId: 'web:https://example.com/a', sourceType: 'web', dedupKeys: ['doi:10.1000/example'] },
    });

    const canonical = await store.findResourceByIdentity('web:https://example.com/a');
    const dedup = await store.findResourceByIdentity('doi:10.1000/example');

    expect(canonical.ok).toBe(true);
    expect(dedup.ok).toBe(true);
    if (!canonical.ok || !dedup.ok) return;
    expect(canonical.value?.id).toBe('res-1');
    expect(dedup.value?.id).toBe('res-1');
  }, 60_000);
});
