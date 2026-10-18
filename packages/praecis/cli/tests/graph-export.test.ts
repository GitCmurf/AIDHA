import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_GRAPH_SCHEMA_VERSION,
  CURRENT_JSONLD_EXPORT_SCHEMA_VERSION,
  JSONLD_CONTEXT,
  SQLiteStore,
  type GraphSnapshot,
} from '@aidha/graph-backend';

const directories: string[] = [];
const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-graph-export-'));
  directories.push(directory);
  const dbPath = join(directory, 'graph.sqlite');
  const configPath = join(directory, 'config.yaml');
  const store = SQLiteStore.open(dbPath);
  let before: GraphSnapshot;
  try {
    for (const [type, id, label, metadata] of [
      ['Resource', 'resource-1', 'Fictional source', { source: 'fixture', provenances: [] }],
      ['Claim', 'claim-1', 'Fictional claim', { confidence: 0.75 }],
      ['Task', 'task-1', 'Existing fictional task', { scope: 'operational' }],
    ] as const) {
      const result = await store.upsertNode(type, id, { label, metadata });
      expect(result.ok).toBe(true);
    }
    expect((await store.upsertEdge('claim-1', 'claimDerivedFrom', 'resource-1', { metadata: {} })).ok).toBe(true);
    expect((await store.upsertEdge('task-1', 'taskMotivatedBy', 'claim-1', { metadata: {} })).ok).toBe(true);
    const snapshot = await store.exportSnapshot({ scope: 'full' });
    if (!snapshot.ok) throw snapshot.error;
    before = snapshot.value;
  } finally {
    await store.close();
  }
  await writeFile(configPath, [
    'config_version: 1', 'default_profile: unused', 'profiles:',
    '  unused:', `    db: ${JSON.stringify(join(directory, 'must-not-create.sqlite'))}`,
    '  selected:', `    db: ${JSON.stringify(dbPath)}`,
    '    llm:', '      model: ""', '      base_url: ""',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
  return {
    directory, dbPath, configPath, before,
    dbBytes: await readFile(dbPath), configBytes: await readFile(configPath),
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function execute(f: Fixture, extra: string[] = []) {
  return executeArgs(f, [
    'export', 'graph', '--jsonld', '--config', f.configPath,
    '--profile', 'selected', ...extra,
  ]);
}

function executeArgs(f: Fixture, args: string[], environment: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: f.directory,
    encoding: 'utf8',
    timeout: 20000,
    env: { PATH: process.env['PATH'] ?? '', LANG: 'C.UTF-8', ...environment },
  });
  expect(result.error).toBeUndefined();
  return result;
}

async function expectInputsUnchanged(f: Fixture) {
  expect(await readFile(f.dbPath)).toEqual(f.dbBytes);
  expect(await readFile(f.configPath)).toEqual(f.configBytes);
  const reopened = SQLiteStore.open(f.dbPath);
  try {
    const after = await reopened.exportSnapshot({ scope: 'full' });
    if (!after.ok) throw after.error;
    expect(after.value).toEqual(f.before);
  } finally {
    await reopened.close();
  }
}

describe('public JSON-LD graph export', () => {
  it.each(['file', 'symlink', 'hardlink', 'directory', 'database', 'config'])(
    'refuses an existing %s destination and preserves its contents', async kind => {
      const f = await fixture();
      const original = join(f.directory, 'existing.txt');
      await writeFile(original, 'Existing owner content', 'utf8');
      const candidate = join(f.directory, 'destination');
      if (kind === 'symlink') await symlink(original, candidate);
      if (kind === 'hardlink') await link(original, candidate);
      if (kind === 'directory') await mkdir(candidate);
      const out = kind === 'database' ? f.dbPath : kind === 'config' ? f.configPath
        : kind === 'file' ? original : candidate;
      const result = execute(f, ['--out', out]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(await readFile(original, 'utf8')).toBe('Existing owner content');
      if (kind === 'directory') expect((await stat(candidate)).isDirectory()).toBe(true);
      await expectInputsUnchanged(f);
    }, 60000,
  );

  it('does not create missing output directories', async () => {
    const f = await fixture();
    const parent = join(f.directory, 'missing-output');
    expect(execute(f, ['--out', join(parent, 'graph.jsonld')]).status).not.toBe(0);
    await expect(stat(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectInputsUnchanged(f);
  }, 60000);

  it.each(['missing', 'corrupt'])('refuses a %s graph without initializing or changing it', async kind => {
    const f = await fixture();
    const target = kind === 'missing' ? join(f.directory, 'absent', 'graph.sqlite')
      : join(f.directory, 'corrupt.sqlite');
    if (kind === 'corrupt') await writeFile(target, 'Not a SQLite database', 'utf8');
    const config = f.configBytes.toString().replace(JSON.stringify(f.dbPath), JSON.stringify(target));
    await writeFile(f.configPath, config, 'utf8');
    f.configBytes = Buffer.from(config);
    const result = execute(f);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    if (kind === 'corrupt') expect(await readFile(target, 'utf8')).toBe('Not a SQLite database');
    else await expect(stat(join(f.directory, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expectInputsUnchanged(f);
  }, 60000);

  it('exports without repairing missing optional schema objects', async () => {
    const f = await fixture();
    const database = new DatabaseSync(f.dbPath);
    database.exec('DROP TABLE IF EXISTS nodes_fts; DROP VIEW v_nodes; DROP INDEX nodes_type_idx');
    const schemaBefore = database.prepare('SELECT name, type, sql FROM sqlite_master ORDER BY name').all();
    database.close();
    const bytesBefore = await readFile(f.dbPath);
    const result = execute(f);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)['@graph']).toHaveLength(3);
    expect(await readFile(f.dbPath)).toEqual(bytesBefore);
    expect(await readFile(f.configPath)).toEqual(f.configBytes);
    const reopened = new DatabaseSync(f.dbPath, { readOnly: true });
    try {
      expect(reopened.prepare('SELECT name, type, sql FROM sqlite_master ORDER BY name').all()).toEqual(schemaBefore);
    } finally { reopened.close(); }
  }, 60000);

  it('resolves dotenv and relative database paths against the configured base directory', async () => {
    const f = await fixture();
    const data = join(f.directory, 'data');
    await mkdir(data);
    const selected = join(data, 'relative.sqlite');
    await copyFile(f.dbPath, selected);
    await writeFile(join(f.directory, 'fixture.env'), 'EXPORT_GRAPH=relative.sqlite\n', 'utf8');
    const config = [
      'config_version: 1', 'base_dir: ./data', 'default_profile: selected',
      'env:', '  dotenv_files: [./fixture.env]', 'profiles:', '  selected:',
      '    db: ${EXPORT_GRAPH}',
    ].join('\n');
    await writeFile(f.configPath, config, 'utf8');
    f.configBytes = Buffer.from(config);
    const result = execute(f);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)['@graph']).toHaveLength(3);
    expect(await readFile(selected)).toEqual(f.dbBytes);
    await expectInputsUnchanged(f);
  }, 60000);

  it.each(['unsupported', ''])('rejects the export mode %j', async mode => {
    const f = await fixture();
    const result = executeArgs(f, ['export', mode, '--jsonld', '--config', f.configPath]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    await expectInputsUnchanged(f);
  }, 60000);

  it.each([
    { label: 'missing output value', args: ['--out'] },
    { label: 'valued boolean flag', args: ['--jsonld', 'unexpected'] },
    { label: 'extra positional argument', args: ['unexpected'] },
    { label: 'unknown force flag', args: ['--force'] },
    { label: 'unknown prototype key', args: ['--__proto__'] },
  ])('rejects $label before creating output', async ({ args }) => {
    const f = await fixture();
    const result = execute(f, args);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    await expectInputsUnchanged(f);
  }, 60000);

  it.each(['argument', 'environment'])('fails closed on a missing explicit config from %s', async method => {
    const f = await fixture();
    const fallback = join(f.directory, 'out', 'aidha.sqlite');
    await mkdir(join(f.directory, 'out'));
    await copyFile(f.dbPath, fallback);
    const fallbackBytes = await readFile(fallback);
    const absent = join(f.directory, 'missing.yaml');
    const result = method === 'argument'
      ? executeArgs(f, ['export', 'graph', '--jsonld', '--config', absent])
      : executeArgs(f, ['export', 'graph', '--jsonld'], { AIDHA_CONFIG: absent });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('missing.yaml');
    expect(await readFile(fallback)).toEqual(fallbackBytes);
    await expectInputsUnchanged(f);
  }, 60000);

  it.each(['-wal', '-shm', '-journal'])('refuses an absent reserved database sidecar %s', async suffix => {
    const f = await fixture();
    const out = `${f.dbPath}${suffix}`;
    const result = execute(f, ['--out', out]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('SQLite sidecar');
    await expect(stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectInputsUnchanged(f);
  }, 60000);

  it('recognizes a reserved sidecar through a symlinked parent directory', async () => {
    const f = await fixture();
    const alias = join(f.directory, 'alias');
    await symlink(f.directory, alias, 'dir');
    const out = join(alias, 'graph.sqlite-wal');
    const result = execute(f, ['--out', out]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SQLite sidecar');
    await expect(stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectInputsUnchanged(f);
  }, 60000);

  it.each(['GRAPH.SQLITE-WAL', 'Graph.Sqlite-Shm', 'graph.SQLITE-JOURNAL'])(
    'reserves case variants of SQLite sidecar names: %s', async name => {
      const f = await fixture();
      const out = join(f.directory, name);
      const result = execute(f, ['--out', out]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('SQLite sidecar');
      await expect(stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
      await expectInputsUnchanged(f);
    }, 60000,
  );

  it('allows a sidecar-like filename in a different physical directory', async () => {
    const f = await fixture();
    const separate = join(f.directory, 'separate');
    await mkdir(separate);
    const out = join(separate, 'GRAPH.SQLITE-WAL');
    const expected = execute(f).stdout;
    const result = execute(f, ['--out', out]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(out, 'utf8')).toBe(expected);
    await expectInputsUnchanged(f);
  }, 60000);

  it('creates a new output file containing the same document without mixing stdout', async () => {
    const f = await fixture();
    const out = join(f.directory, 'export.jsonld');
    const expected = execute(f).stdout;
    const result = execute(f, ['--out', out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(out, 'utf8')).toBe(expected);
    await expectInputsUnchanged(f);
  }, 60000);

  it('exports the selected full graph deterministically without changing its inputs', async () => {
    const f = await fixture();
    const result = execute(f);
    expect(result.status).toBe(0);
    expect(result.stdout.trimStart().startsWith('{')).toBe(true);
    const timestamps = (id: string) => {
      const node = f.before.nodes.find(item => item.id === id);
      if (!node) throw new Error(`Missing fixture ${id}`);
      return { createdAt: node.createdAt, updatedAt: node.updatedAt };
    };
    expect(JSON.parse(result.stdout)).toEqual({
      '@context': JSONLD_CONTEXT['@context'],
      schemaVersion: CURRENT_JSONLD_EXPORT_SCHEMA_VERSION,
      '@graph': [
        { '@id': 'urn:aidha:node:claim-1', '@type': 'Claim', schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
          label: 'Fictional claim', confidence: 0.75, ...timestamps('claim-1'),
          claimDerivedFrom: 'urn:aidha:node:resource-1' },
        { '@id': 'urn:aidha:node:resource-1', '@type': 'Resource', schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
          label: 'Fictional source', source: 'fixture', provenances: [], ...timestamps('resource-1') },
        { '@id': 'urn:aidha:node:task-1', '@type': 'Task', schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
          label: 'Existing fictional task', scope: 'operational', ...timestamps('task-1'),
          taskMotivatedBy: 'urn:aidha:node:claim-1' },
      ],
    });
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(execute(f).stdout).toBe(result.stdout);
    await expectInputsUnchanged(f);
  }, 60000);
});
