import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteStore } from '@aidha/graph-backend';

describe('public YouTube ingestion failure', () => {
  it('reports the acquisition cause and preserves the graph after the executable exits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-transcript-failure-'));
    const dbPath = join(directory, 'graph.sqlite');
    const configPath = join(directory, 'config.yaml');
    try {
      const initial = SQLiteStore.open(dbPath);
      const before = await (async () => {
        try {
          const created = await initial.upsertNode('Resource', 'keep:existing', {
            label: 'Existing fictional source', metadata: {},
          });
          expect(created.ok).toBe(true);
          const related = await initial.upsertNode('Resource', 'keep:related', {
            label: 'Related fictional source', metadata: {},
          });
          expect(related.ok).toBe(true);
          const edge = await initial.upsertEdge('keep:existing', 'relatedTo', 'keep:related', { metadata: {} });
          expect(edge.ok).toBe(true);
          const snapshot = await initial.exportSnapshot({ scope: 'full' });
          expect(snapshot.ok).toBe(true);
          if (!snapshot.ok) throw snapshot.error;
          return snapshot.value;
        } finally { await initial.close(); }
      })();
      await writeFile(configPath, [
        'config_version: 1', 'default_profile: default', 'profiles:', '  default:',
        `    db: ${JSON.stringify(dbPath)}`,
        '    llm:', '      model: ""', '      base_url: ""',
        `      cache_dir: ${JSON.stringify(join(directory, 'cache'))}`,
      ].join('\n'), 'utf8');
      const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
      const processResult = spawnSync(process.execPath,
        [cliPath, 'ingest', 'youtube', '--url', 'no-transcript-video', '--mock', '--json', '--config', configPath],
        { encoding: 'utf8', timeout: 20000, cwd: directory,
          env: { PATH: process.env['PATH'] ?? '', LANG: 'C.UTF-8' } });
      expect(processResult.error).toBeUndefined();
      expect(processResult.status).toBe(1);
      expect(processResult.stdout).toBe('');
      expect(processResult.stderr).toContain('Transcript not found');
      expect(processResult.stderr).not.toContain('no transcript in payload');
      const reopened = SQLiteStore.open(dbPath);
      try {
        const after = await reopened.exportSnapshot({ scope: 'full' });
        expect(after.ok).toBe(true);
        if (!after.ok) throw after.error;
        expect(after.value).toEqual(before);
      } finally { await reopened.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60000);
});
