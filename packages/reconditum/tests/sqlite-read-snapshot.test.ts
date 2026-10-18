// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/store/sqlite.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-read-snapshot-'));
  directories.push(directory);
  const path = join(directory, 'graph.sqlite');
  const store = SQLiteStore.open(path);
  try {
    expect((await store.upsertNode('Resource', 'first', { label: 'First', metadata: {} })).ok).toBe(true);
    expect((await store.upsertNode('Resource', 'second', { label: 'Second', metadata: { scope: 'operational' } })).ok).toBe(true);
    expect((await store.upsertEdge('first', 'relatedTo', 'second', { metadata: {} })).ok).toBe(true);
    const result = await store.exportSnapshot({ scope: 'full' });
    if (!result.ok) throw result.error;
    return { directory, path, snapshot: result.value };
  } finally { await store.close(); }
}

describe('SQLiteStore.readSnapshot', () => {
  it('reads the full existing graph without changing its bytes and honors knowledge scope', async () => {
    const { path, snapshot } = await fixture();
    const before = await readFile(path);
    expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: true, value: snapshot });
    expect(await readFile(path)).toEqual(before);
    const knowledge = await SQLiteStore.readSnapshot(path, { scope: 'knowledge' });
    expect(knowledge.ok).toBe(true);
    if (!knowledge.ok) throw knowledge.error;
    expect(knowledge.value.nodes.map(node => node.id)).toEqual(['first']);
    expect(knowledge.value.edges).toEqual([]);
  });

  it('does not initialize missing views, indexes or FTS structures', async () => {
    const { path, snapshot } = await fixture();
    const database = new DatabaseSync(path);
    database.exec('DROP VIEW v_nodes; DROP INDEX nodes_type_idx; DROP TABLE IF EXISTS nodes_fts');
    database.close();
    const before = await readFile(path);
    expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: true, value: snapshot });
    expect(await readFile(path)).toEqual(before);
  });

  it('keeps one coherent view when another WAL connection commits between node and edge reads', async () => {
    const { path, snapshot } = await fixture();
    const writer = new DatabaseSync(path);
    writer.exec('PRAGMA journal_mode=WAL');
    const original = SQLiteStore.prototype.queryNodes;
    const query = vi.spyOn(SQLiteStore.prototype, 'queryNodes').mockImplementation(async function (this: SQLiteStore, options) {
      const result = await original.call(this, options);
      writer.exec("BEGIN IMMEDIATE; DELETE FROM edges; DELETE FROM nodes WHERE id = 'second'; COMMIT");
      return result;
    });
    try {
      expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: true, value: snapshot });
      query.mockRestore();
      const latest = await SQLiteStore.readSnapshot(path);
      expect(latest.ok).toBe(true);
      if (!latest.ok) throw latest.error;
      expect(latest.value.nodes.map(node => node.id)).toEqual(['first']);
      expect(latest.value.edges).toEqual([]);
    } finally { writer.close(); }
  });

  it('does not create a missing database or its parent', async () => {
    const { directory } = await fixture();
    const absentFile = join(directory, 'missing.sqlite');
    expect((await SQLiteStore.readSnapshot(absentFile)).ok).toBe(false);
    await expect(stat(absentFile)).rejects.toMatchObject({ code: 'ENOENT' });
    const missing = join(directory, 'absent', 'graph.sqlite');
    expect((await SQLiteStore.readSnapshot(missing)).ok).toBe(false);
    await expect(stat(join(directory, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns corrupt and incomplete-schema failures without changing files and closes connections', async () => {
    const { directory } = await fixture();
    const corrupt = join(directory, 'corrupt.sqlite');
    await writeFile(corrupt, 'not a sqlite database');
    const invalid = join(directory, 'invalid.sqlite');
    const database = new DatabaseSync(invalid);
    database.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY)');
    database.close();
    for (const path of [corrupt, invalid]) {
      const before = await readFile(path);
      const close = vi.spyOn(DatabaseSync.prototype, 'close');
      expect((await SQLiteStore.readSnapshot(path)).ok).toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
      close.mockRestore();
      expect(await readFile(path)).toEqual(before);
    }
  });

  it('opens a connection that rejects writes even through the wrapped store', async () => {
    const { path, snapshot } = await fixture();
    const original = SQLiteStore.prototype.exportSnapshot;
    vi.spyOn(SQLiteStore.prototype, 'exportSnapshot').mockImplementation(async function (this: SQLiteStore, options) {
      const attempted = await this.upsertNode('Resource', 'forbidden', { label: 'Must not persist', metadata: {} });
      expect(attempted.ok).toBe(false);
      if (!attempted.ok) expect(attempted.error.message).toMatch(/readonly|read-only/i);
      return original.call(this, options);
    });
    expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: true, value: snapshot });
  });

  it('closes the connection when snapshot acquisition unexpectedly throws', async () => {
    const { path } = await fixture();
    const error = new Error('Fictional snapshot failure');
    vi.spyOn(SQLiteStore.prototype, 'exportSnapshot').mockRejectedValue(error);
    const close = vi.spyOn(DatabaseSync.prototype, 'close');
    expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: false, error });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('preserves the primary snapshot error when closing also reports a failure', async () => {
    const { path } = await fixture();
    const primary = new Error('Fictional primary snapshot failure');
    const secondary = new Error('Fictional secondary close failure');
    vi.spyOn(SQLiteStore.prototype, 'exportSnapshot').mockRejectedValue(primary);
    const closeOriginal = DatabaseSync.prototype.close;
    const close = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
      closeOriginal.call(this);
      throw secondary;
    });
    expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: false, error: primary });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports closing failure after an otherwise successful snapshot', async () => {
    const { path } = await fixture();
    const secondary = new Error('Fictional close failure after snapshot');
    const closeOriginal = DatabaseSync.prototype.close;
    const close = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
      closeOriginal.call(this);
      throw secondary;
    });
    expect(await SQLiteStore.readSnapshot(path)).toEqual({ ok: false, error: secondary });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['22.5.0', '22.11.9', '23.0.0', '23.1.0'])('refuses unsupported Node %s before opening a file', async version => {
    const actual = process.versions.node;
    Object.defineProperty(process.versions, 'node', { value: version, configurable: true });
    try {
      const close = vi.spyOn(DatabaseSync.prototype, 'close');
      const result = await SQLiteStore.readSnapshot('/definitely/missing/graph.sqlite');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Read-only');
      expect(close).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.versions, 'node', { value: actual, configurable: true });
    }
  });
});
