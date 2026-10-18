import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdtemp, open, readFile, rm, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNewOutput } from '../src/export-graph.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-export-write-'));
  directories.push(directory);
  const probe = await open(join(directory, 'probe'), 'wx');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const original = prototype.writeFile;
  await probe.close();
  return { directory, prototype, original, destination: join(directory, 'graph.jsonld') };
}

describe('new export output ownership', () => {
  it('removes its own partially written file and preserves the write failure', async () => {
    const f = await fixture();
    const failure = new Error('Fictional disk-full failure');
    vi.spyOn(f.prototype, 'writeFile').mockImplementation(async function (this: FileHandle) {
      await f.original.call(this, 'partial', 'utf8');
      throw failure;
    });
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove another file that replaces its partial output before failure', async () => {
    const f = await fixture();
    const failure = new Error('Fictional write interruption');
    vi.spyOn(f.prototype, 'writeFile').mockImplementation(async function (this: FileHandle) {
      await f.original.call(this, 'partial', 'utf8');
      await unlink(f.destination);
      const replacement = await open(f.destination, 'wx');
      try { await f.original.call(replacement, 'Other owner', 'utf8'); }
      finally { await replacement.close(); }
      throw failure;
    });
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    expect(await readFile(f.destination, 'utf8')).toBe('Other owner');
  });

  it('refuses existing output before invoking a write', async () => {
    const f = await fixture();
    await writeFile(f.destination, 'Existing output', 'utf8');
    const write = vi.spyOn(f.prototype, 'writeFile');
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(write).not.toHaveBeenCalled();
    expect(await readFile(f.destination, 'utf8')).toBe('Existing output');
  });
});
