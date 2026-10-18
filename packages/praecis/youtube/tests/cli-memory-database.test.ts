// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('public CLI SQLite memory database', () => {
  beforeAll(() => {
    const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const built = spawnSync('pnpm', ['--filter', '@aidha/ingestion-youtube...', 'build'], {
      cwd: workspaceRoot, encoding: 'utf8', timeout: 120000,
      // pnpm's env-node launcher must use the same runtime as this test process.
      env: { PATH: `${dirname(process.execPath)}${delimiter}${process.env['PATH'] ?? ''}`, LANG: 'C.UTF-8' },
    });
    expect(built.error, built.stderr || built.stdout).toBeUndefined();
    expect(built.status, built.stderr || built.stdout).toBe(0);
  }, 125000);

  it('ingests offline into memory without creating a database and does not retain the source on reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-memory-cli-'));
    try {
      const config = join(directory, 'config.yaml');
      await writeFile(config, 'config_version: 1\ndefault_profile: selected\nprofiles:\n  selected: {}\n', { mode: 0o600 });
      const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
      const run = (args: string[]) => spawnSync(process.execPath,
        [...(process.allowedNodeEnvironmentFlags.has('--experimental-sqlite') ? ['--experimental-sqlite'] : []),
          cli, ...args, '--db', ':memory:', '--config', config],
        { cwd: directory, encoding: 'utf8', timeout: 20000, env: { PATH: process.env['PATH'] ?? '', LANG: 'C.UTF-8' } });
      const ingested = run(['ingest', 'video', 'test-video', '--mock']);
      expect(ingested.error).toBeUndefined();
      expect(ingested.status, ingested.stderr).toBe(0);
      expect(ingested.stdout).toContain('Ingested video test-video');
      await expect(stat(join(directory, ':memory:'))).rejects.toMatchObject({ code: 'ENOENT' });
      const reopened = run(['export', 'transcript', 'video', 'test-video', '--out', join(directory, 'transcript.json')]);
      expect(reopened.error).toBeUndefined();
      expect(reopened.status).toBe(1);
      expect(reopened.stderr).toContain('Resource not found: youtube-test-video');
      await expect(stat(join(directory, ':memory:'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(directory, 'transcript.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60000);
});
