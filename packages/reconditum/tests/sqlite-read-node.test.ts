// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/store/sqlite.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-read-node-'));
  directories.push(directory);
  const path = join(directory, 'graph.sqlite');
  const id = "case' OR 1=1 --";
  const store = SQLiteStore.open(path);
  try {
    const saved = await store.upsertNode('Resource', id, {
      label: 'Exact saved record', content: 'Retained content', metadata: { fixture: true },
    });
    if (!saved.ok) throw saved.error;
    expect((await store.upsertNode('Resource', 'unrelated', { label: 'Unrelated record', metadata: {} })).ok).toBe(true);
    return { directory, path, id, node: saved.value.node };
  } finally { await store.close(); }
};

describe('SQLiteStore.readNode', () => {
  it.each([
    ['snapshot', (path: string) => {
      const read = SQLiteStore.readSnapshot;
      return read(path);
    }],
    ['node', (path: string) => {
      const read = SQLiteStore.readNode;
      return read(path, 'missing-node');
    }],
  ] as const)('returns a Result from detached %s reads', async (_label, read) => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-detached-read-'));
    directories.push(directory);
    const path = join(directory, 'missing.sqlite');
    const result = await read(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Error);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('selects the exact key without depending on unrelated graph structures or repairing them', async () => {
    const { directory, path, id, node } = await fixture();
    const database = new DatabaseSync(path);
    database.exec('DROP TABLE edges; DROP VIEW v_nodes; DROP INDEX nodes_type_idx; DROP TABLE IF EXISTS nodes_fts');
    database.close();
    const before = await readFile(path);
    const filesBefore = (await readdir(directory)).sort();
    expect(await SQLiteStore.readNode(path, id)).toEqual({ ok: true, value: node });
    expect(await SQLiteStore.readNode(path, "missing' OR 1=1 --")).toEqual({ ok: true, value: null });
    expect(await readFile(path)).toEqual(before);
    expect((await readdir(directory)).sort()).toEqual(filesBefore);
  });

  it('does not create a missing database or its parent', async () => {
    const { directory } = await fixture();
    for (const path of [join(directory, 'missing.sqlite'), join(directory, 'absent', 'graph.sqlite')]) {
      expect((await SQLiteStore.readNode(path, 'missing')).ok).toBe(false);
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(stat(join(directory, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports invalid selected nodes while leaving valid unrelated records readable', async () => {
    const { path, id, node } = await fixture();
    const database = new DatabaseSync(path);
    database.prepare('UPDATE nodes SET type = ? WHERE id = ?').run('InvalidNodeType', 'unrelated');
    database.close();
    const before = await readFile(path);
    expect(await SQLiteStore.readNode(path, id)).toEqual({ ok: true, value: node });
    expect((await SQLiteStore.readNode(path, 'unrelated')).ok).toBe(false);
    expect(await readFile(path)).toEqual(before);
  });

  it('returns corrupt and incomplete-schema errors without mutation and closes each connection', async () => {
    const { directory } = await fixture();
    const corrupt = join(directory, 'corrupt.sqlite');
    await writeFile(corrupt, 'not a sqlite database');
    const incomplete = join(directory, 'incomplete.sqlite');
    const database = new DatabaseSync(incomplete);
    database.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY)');
    database.close();
    for (const path of [corrupt, incomplete]) {
      const before = await readFile(path);
      const close = vi.spyOn(DatabaseSync.prototype, 'close');
      expect((await SQLiteStore.readNode(path, 'case')).ok).toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
      close.mockRestore();
      expect(await readFile(path)).toEqual(before);
    }
  });

  it.each(['22.5.0', '22.11.9', '23.0.0', '23.1.0'])(
    'refuses unsupported Node %s before opening a file', async version => {
      const actual = process.versions.node;
      Object.defineProperty(process.versions, 'node', { value: version, configurable: true });
      try {
        const close = vi.spyOn(DatabaseSync.prototype, 'close');
        const result = await SQLiteStore.readNode('/definitely/missing/graph.sqlite', 'case');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Read-only graph access requires Node.js');
        expect(close).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process.versions, 'node', { value: actual, configurable: true });
      }
    },
  );
});
