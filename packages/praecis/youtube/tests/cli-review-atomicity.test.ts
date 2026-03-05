import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '@aidha/graph-backend';
import { runCli } from '../src/cli.js';
import { describeIfSqlite } from './test-utils.js';

describeIfSqlite('CLI review apply atomicity', () => {
  let tempRoot = '';
  let dbPath = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-review-'));
    dbPath = join(tempRoot, 'aidha.sqlite');

    const store = SQLiteStore.open(dbPath);
    await store.upsertNode('Resource', 'youtube-cli-video', {
      label: 'CLI Video',
      metadata: { videoId: 'cli-video', url: 'https://www.youtube.com/watch?v=cli-video' },
    });
    await store.upsertNode('Claim', 'claim-cli-a', {
      label: 'Claim CLI A',
      content: 'Claim CLI A',
      metadata: { resourceId: 'youtube-cli-video', videoId: 'cli-video', state: 'draft' },
    });
    await store.upsertNode('Claim', 'claim-cli-b', {
      label: 'Claim CLI B',
      content: 'Claim CLI B',
      metadata: { resourceId: 'youtube-cli-video', videoId: 'cli-video', state: 'draft' },
    });
    await store.close();
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns non-zero and leaves snapshot unchanged on failed mixed-claim batch', async () => {
    const beforeStore = SQLiteStore.open(dbPath);
    const beforeSnapshot = await beforeStore.exportSnapshot({ scope: 'full' });
    expect(beforeSnapshot.ok).toBe(true);
    await beforeStore.close();
    if (!beforeSnapshot.ok) return;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitCode = await runCli([
      'review',
      'apply',
      '--db',
      dbPath,
      '--claims',
      'claim-cli-a,missing-claim,claim-cli-b',
      '--accept',
      '--tag',
      'atomic',
    ]);
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(exitCode).toBe(1);

    const afterStore = SQLiteStore.open(dbPath);
    const afterSnapshot = await afterStore.exportSnapshot({ scope: 'full' });
    expect(afterSnapshot.ok).toBe(true);
    await afterStore.close();
    if (!afterSnapshot.ok) return;

    expect(afterSnapshot.value).toEqual(beforeSnapshot.value);
  });
});
