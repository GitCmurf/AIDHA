// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../src/store/sqlite.js';

const sqliteDescribe = SQLiteStore.isAvailable() ? describe : describe.skip;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const databasePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-knowledge-fts-'));
  directories.push(directory);
  return join(directory, 'graph.sqlite');
};

sqliteDescribe('SQLiteStore Knowledge text search', () => {
  it('finds saved knowledge by its prose and keeps results current after edits and deletion', async () => {
    const store = SQLiteStore.createInMemory();
    try {
      expect(store.supportsFts()).toBe(true);
      expect((await store.upsertNode('Knowledge', 'reading-note', {
        label: 'Saved reading note', content: 'Fictional telescopes reveal distant planets.', metadata: {},
      })).ok).toBe(true);
      expect((await store.upsertNode('Excerpt', 'source-passage', {
        label: 'Source passage', content: 'Fictional telescopes reveal distant planets.', metadata: {},
      })).ok).toBe(true);

      expect(store.searchText('telescopes', ['Knowledge']))
        .toEqual({ ok: true, value: new Set(['reading-note']) });
      expect(store.searchText('telescopes', ['Excerpt']))
        .toEqual({ ok: true, value: new Set(['source-passage']) });
      expect(store.searchText('telescopes'))
        .toEqual({ ok: true, value: new Set(['reading-note', 'source-passage']) });

      expect((await store.upsertNode('Knowledge', 'reading-note', {
        label: 'Revised reading note', content: 'Fictional microscopes reveal tiny organisms.', metadata: {},
      })).ok).toBe(true);
      expect(store.searchText('telescopes', ['Knowledge']))
        .toEqual({ ok: true, value: new Set() });
      expect(store.searchText('microscopes', ['Knowledge']))
        .toEqual({ ok: true, value: new Set(['reading-note']) });

      expect((await store.deleteNode('reading-note')).ok).toBe(true);
      expect(store.searchText('microscopes', ['Knowledge']))
        .toEqual({ ok: true, value: new Set() });
    } finally {
      await store.close();
    }
  });

  it('recovers saved knowledge missing from an older index after closing and reopening the file', async () => {
    const path = await databasePath();
    const original = SQLiteStore.open(path);
    let saved: Awaited<ReturnType<SQLiteStore['getNode']>>;
    try {
      expect(original.supportsFts()).toBe(true);
      expect((await original.upsertNode('Knowledge', 'saved-brief', {
        label: 'A saved brief', content: 'Fictional satellites measure distant nebulae.',
        metadata: { sourceId: 'fictional-source', reviewState: 'draft' },
      })).ok).toBe(true);
      expect((await original.upsertNode('Claim', 'saved-claim', {
        label: 'A source claim', content: 'Fictional satellites measure distant nebulae.', metadata: {},
      })).ok).toBe(true);
      expect((await original.upsertNode('Topic', 'saved-topic', {
        label: 'Astronomy', metadata: {},
      })).ok).toBe(true);
      saved = await original.getNode('saved-brief');
      expect(saved.ok && saved.value).toMatchObject({
        id: 'saved-brief', metadata: { sourceId: 'fictional-source', reviewState: 'draft' },
      });
    } finally {
      await original.close();
    }

    // Earlier stores persisted Knowledge but indexed only Claim, Excerpt and Resource.
    const legacy = new DatabaseSync(path);
    try {
      legacy.prepare('DELETE FROM nodes_fts WHERE type = ?').run('Knowledge');
    } finally {
      legacy.close();
    }

    const reopened = SQLiteStore.open(path);
    try {
      expect(await reopened.getNode('saved-brief')).toEqual(saved);
      expect(reopened.searchText('nebulae', ['Knowledge']))
        .toEqual({ ok: true, value: new Set(['saved-brief']) });
      expect(reopened.searchText('nebulae', ['Claim']))
        .toEqual({ ok: true, value: new Set(['saved-claim']) });
    } finally {
      await reopened.close();
    }
  });

  it('reopens a complete index containing Knowledge and an unindexed Topic without writes', async () => {
    const path = await databasePath();
    const original = SQLiteStore.open(path);
    try {
      expect(original.supportsFts()).toBe(true);
      expect((await original.upsertNode('Knowledge', 'note-reopen', {
        label: 'Saved note', content: 'Fictional astronomy reading notes.', metadata: {},
      })).ok).toBe(true);
      expect((await original.upsertNode('Claim', 'claim-reopen', {
        label: 'A claim', content: 'Searchable fictional astronomy passage.', metadata: {},
      })).ok).toBe(true);
      expect((await original.upsertNode('Topic', 'topic-reopen', {
        label: 'Astronomy', metadata: {},
      })).ok).toBe(true);
    } finally {
      await original.close();
    }

    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      const before = observer.prepare('PRAGMA data_version').get();
      const reopened = SQLiteStore.open(path);
      try {
        expect(reopened.searchText('astronomy', ['Claim']))
          .toEqual({ ok: true, value: new Set(['claim-reopen']) });
        expect(reopened.searchText('astronomy', ['Knowledge']))
          .toEqual({ ok: true, value: new Set(['note-reopen']) });
      } finally {
        await reopened.close();
      }
      expect(observer.prepare('PRAGMA data_version').get()).toEqual(before);
    } finally {
      observer.close();
    }
  });
});
