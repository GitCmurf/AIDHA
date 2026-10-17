import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAdapterCli } from './adapters.mjs';

test('offline CLI writes a reviewable comparison proposal exclusively and has no live mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-adapters-'));
  try {
    const path = join(directory, 'plan.json');
    await runAdapterCli(['--plan', path]);
    const saved = await readFile(path, 'utf8');
    assert.equal(JSON.parse(saved).executionAllowed, false);
    assert.equal(JSON.parse(saved).counts.maximumCalls, 294);
    await assert.rejects(runAdapterCli(['--plan', path]), /EEXIST/);
    await assert.rejects(runAdapterCli(['--live', path]), /Offline/);
    assert.equal(await readFile(path, 'utf8'), saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
