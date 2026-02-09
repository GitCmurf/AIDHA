import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '@aidha/graph-backend';
import { runCli } from '../src/cli.js';

describe('CLI claims purge', () => {
  let tempRoot = '';
  let dbPath = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-claims-purge-'));
    dbPath = join(tempRoot, 'aidha.sqlite');
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('purges claims for a video without deleting its resource/excerpts', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const ingestCode = await runCli(['ingest', 'video', 'test-video', '--db', dbPath, '--mock']);
    const extractCode = await runCli(['extract', 'claims', 'test-video', '--db', dbPath]);
    const purgeCode = await runCli(['claims', 'purge', 'test-video', '--db', dbPath]);

    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(ingestCode).toBe(0);
    expect(extractCode).toBe(0);
    expect(purgeCode).toBe(0);

    const store = SQLiteStore.open(dbPath);
    const claims = await store.queryNodes({ type: 'Claim', filters: { resourceId: 'youtube-test-video' } });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items).toHaveLength(0);

    const resource = await store.getNode('youtube-test-video');
    expect(resource.ok).toBe(true);
    if (!resource.ok) return;
    expect(resource.value).not.toBeNull();

    const excerpts = await store.queryNodes({ type: 'Excerpt', filters: { resourceId: 'youtube-test-video' } });
    expect(excerpts.ok).toBe(true);
    if (!excerpts.ok) return;
    expect(excerpts.value.items.length).toBeGreaterThan(0);
    await store.close();
  }, 20_000);

  it('prints usage when video target is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runCli(['claims', 'purge', '--db', dbPath]);
    expect(code).toBe(1);
    const output = errorSpy.mock.calls.map(call => String(call[0] ?? '')).join('\n');
    expect(output).toContain('Usage: claims purge <videoIdOrUrl>');
    errorSpy.mockRestore();
  });
});
