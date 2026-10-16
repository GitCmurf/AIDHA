/**
 * SQLite FTS tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../src/store/index.js';

const sqliteDescribe = SQLiteStore.isAvailable() ? describe : describe.skip;

sqliteDescribe('SQLiteStore FTS', () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = SQLiteStore.createInMemory();
  });

  afterEach(async () => {
    await store.close();
  });

  it('indexes claim, excerpt, and resource text', async () => {
    if (!store.supportsFts()) {
      expect(store.supportsFts()).toBe(false);
      return;
    }

    await store.upsertNode('Claim', 'claim-1', {
      label: 'TypeScript claim',
      content: 'Learn TypeScript for safer code.',
    });
    await store.upsertNode('Excerpt', 'excerpt-1', {
      label: 'Excerpt',
      content: 'Transcript mentions TypeScript basics.',
    });
    await store.upsertNode('Resource', 'resource-1', {
      label: 'TypeScript video',
      content: 'A video about TypeScript.',
    });

    const claims = store.searchText('TypeScript', ['Claim']);
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.has('claim-1')).toBe(true);

    const excerpts = store.searchText('Transcript', ['Excerpt']);
    expect(excerpts.ok).toBe(true);
    if (!excerpts.ok) return;
    expect(excerpts.value.has('excerpt-1')).toBe(true);

    const resources = store.searchText('TypeScript', ['Resource']);
    expect(resources.ok).toBe(true);
    if (!resources.ok) return;
    expect(resources.value.has('resource-1')).toBe(true);
  });

  it('removes deleted nodes from the index', async () => {
    if (!store.supportsFts()) {
      expect(store.supportsFts()).toBe(false);
      return;
    }

    await store.upsertNode('Claim', 'claim-2', {
      label: 'Delete me',
      content: 'This claim should disappear from FTS.',
    });
    let claims = store.searchText('disappear', ['Claim']);
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.has('claim-2')).toBe(true);

    await store.deleteNode('claim-2');
    claims = store.searchText('disappear', ['Claim']);
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.has('claim-2')).toBe(false);
  });

  it('returns an error result for malformed FTS syntax', async () => {
    if (!store.supportsFts()) {
      expect(store.supportsFts()).toBe(false);
      return;
    }

    await store.upsertNode('Claim', 'claim-3', {
      label: 'FTS syntax test',
      content: 'Query behavior should not throw.',
    });

    const result = store.searchText('(', ['Claim']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(Error);
  });

  it('reopens a complete search index without writing when other node types exist', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const original = new SQLiteStore(db);
    try {
      if (!original.supportsFts()) return;
      expect((await original.upsertNode('Claim', 'claim-reopen', {
        label: 'A claim', content: 'Searchable fictional astronomy passage.',
      })).ok).toBe(true);
      expect((await original.upsertNode('Topic', 'topic-reopen', {
        label: 'Astronomy',
      })).ok).toBe(true);
      const before = db.prepare('SELECT total_changes() AS count').get();

      const reopened = new SQLiteStore(db);

      expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
      const result = reopened.searchText('astronomy', ['Claim']);
      expect(result.ok && [...result.value]).toEqual(['claim-reopen']);
    } finally {
      await original.close();
    }
  });

  it('restores missing indexed text on reopen even with other node types', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const original = new SQLiteStore(db);
    try {
      if (!original.supportsFts()) return;
      expect((await original.upsertNode('Excerpt', 'excerpt-recover', {
        label: 'A passage', content: 'Fictional telescopes observe distant planets.',
      })).ok).toBe(true);
      expect((await original.upsertNode('Topic', 'topic-recover', {
        label: 'Astronomy',
      })).ok).toBe(true);
      // Reproduce an incomplete persisted index, as after an earlier indexing failure.
      db.exec('DELETE FROM nodes_fts');

      const reopened = new SQLiteStore(db);

      const result = reopened.searchText('planets', ['Excerpt']);
      expect(result.ok && [...result.value]).toEqual(['excerpt-recover']);
      const before = db.prepare('SELECT total_changes() AS count').get();
      const reopenedAgain = new SQLiteStore(db);
      expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
      const repeatedResult = reopenedAgain.searchText('planets', ['Excerpt']);
      expect(repeatedResult.ok && [...repeatedResult.value]).toEqual(['excerpt-recover']);
    } finally {
      await original.close();
    }
  });
});
