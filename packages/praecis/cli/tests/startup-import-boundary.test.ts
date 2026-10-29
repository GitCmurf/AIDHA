import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { SQLiteStore } from '@aidha/graph-backend';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number);
const supportsReadOnlySnapshots = nodeMajor >= 24 || (nodeMajor === 23 && nodeMinor >= 2) ||
  (nodeMajor === 22 && nodeMinor >= 12);
const sqliteFlags = process.allowedNodeEnvironmentFlags.has('--experimental-sqlite')
  ? ['--experimental-sqlite'] : [];
const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-cli-startup-boundary-'));
  directories.push(directory);
  const databasePath = join(directory, 'graph.sqlite');
  const configPath = join(directory, 'config.yaml');
  const loaderPath = join(directory, 'reject-nlp-loader.mjs');

  const store = SQLiteStore.open(databasePath);
  try {
    const result = await store.upsertNode('Resource', 'resource-startup', {
      label: 'Fictional startup fixture',
      metadata: { source: 'fixture', provenances: [] },
    });
    expect(result.ok).toBe(true);
  } finally {
    await store.close();
  }

  await writeFile(configPath, [
    'config_version: 1',
    'default_profile: selected',
    'profiles:',
    '  selected:',
    `    db: ${JSON.stringify(databasePath)}`,
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
  await writeFile(loaderPath, [
    'export async function resolve(specifier, context, nextResolve) {',
    "  if (specifier === 'compromise') {",
    "    throw new Error('startup-import test rejected the NLP dependency');",
    '  }',
    '  return nextResolve(specifier, context);',
    '}',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
  return { directory, configPath, loaderPath };
}

function execute(f: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  return spawnSync(process.execPath, [
    ...sqliteFlags,
    '--experimental-loader',
    f.loaderPath,
    cliPath,
    ...args,
  ], {
    cwd: f.directory,
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: process.env['PATH'] ?? '', LANG: 'C.UTF-8' },
  });
}

describe.runIf(supportsReadOnlySnapshots)('CLI startup import boundary', () => {
  it('prints help without importing the core NLP dependency', async () => {
    const f = await fixture();
    const result = execute(f, ['--help']);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('AIDHA');
    expect(result.stdout).toContain('export graph --jsonld');
  }, 90000);

  it('exports JSON-LD without importing the core NLP dependency', async () => {
    const f = await fixture();
    const result = execute(f, [
      'export', 'graph', '--jsonld', '--config', f.configPath, '--profile', 'selected',
    ]);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const document = JSON.parse(result.stdout) as { '@context'?: unknown; '@graph'?: Array<{ '@id'?: string }> };
    expect(document['@context']).toBeDefined();
    expect(document['@graph']?.map(node => node['@id'])).toContain('urn:aidha:node:resource-startup');
  }, 90000);

  it('explains configuration without importing the core NLP dependency', async () => {
    const f = await fixture();
    const result = execute(f, ['config', 'explain', 'db', '--config', f.configPath, '--profile', 'selected']);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('db');
  }, 90000);

  it('uses the shared registrations to reject invalid source configuration', async () => {
    const f = await fixture();
    const invalidConfig = join(f.directory, 'invalid-config.yaml');
    await writeFile(invalidConfig, [
      'config_version: 1',
      'default_profile: selected',
      'profiles:',
      '  selected:',
      `    db: ${JSON.stringify(join(f.directory, 'invalid.sqlite'))}`,
      'sources:',
      '  web:',
      '    private_key: unexpected',
    ].join('\n'), { encoding: 'utf8', mode: 0o600 });
    const result = execute(f, ['config', 'explain', 'activeSourceConfig', '--source', 'web', '--config', invalidConfig]);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('web source config does not accept source-private keys');
  }, 90000);

  it('keeps the NLP dependency on the ingestion command path', async () => {
    const f = await fixture();
    const result = execute(f, ['ingest', 'web', '--url', 'https://fixture.invalid']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('startup-import test rejected the NLP dependency');
  }, 90000);
});
