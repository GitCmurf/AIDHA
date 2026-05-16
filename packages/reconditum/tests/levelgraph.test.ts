import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { LevelGraphStore } from '../src/store/index.js';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

describe('LevelGraphStore', () => {
  it('supports a first write against the in-memory adapter', async () => {
    const store = LevelGraphStore.createInMemory();

    try {
      const createResult = await withTimeout(
        store.upsertNode('Knowledge', 'levelgraph-node-1', { label: 'LevelGraph node' }),
        1000,
        'LevelGraphStore.createInMemory().upsertNode'
      );

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      expect(createResult.value.created).toBe(true);

      const getResult = await withTimeout(
        store.getNode('levelgraph-node-1'),
        1000,
        'LevelGraphStore.createInMemory().getNode'
      );

      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value?.id).toBe('levelgraph-node-1');
      expect(getResult.value?.label).toBe('LevelGraph node');
    } finally {
      await store.close();
    }
  });

  it('supports a first write against the file-backed adapter', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aidha-reconditum-levelgraph-'));
    const storePath = join(tempDir, 'db');
    let store = await LevelGraphStore.create(storePath);

    try {
      const createResult = await withTimeout(
        store.upsertNode('Knowledge', 'levelgraph-node-2', { label: 'Persisted node' }),
        1000,
        'LevelGraphStore.create().upsertNode'
      );

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      expect(createResult.value.created).toBe(true);

      // Close the store to force persistence
      await store.close();

      // Reopen a new instance from the same path
      store = await LevelGraphStore.create(storePath);

      const getResult = await withTimeout(
        store.getNode('levelgraph-node-2'),
        1000,
        'LevelGraphStore.create().getNode (reopened)'
      );

      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value?.id).toBe('levelgraph-node-2');
      expect(getResult.value?.label).toBe('Persisted node');
    } finally {
      await store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
