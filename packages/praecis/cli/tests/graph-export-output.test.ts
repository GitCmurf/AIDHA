import { afterEach, describe, expect, it, vi } from 'vitest';
import { link, lstat, mkdtemp, open, readFile, readdir, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNewOutput } from '../src/export-graph.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, link: vi.fn(original.link), open: vi.fn(original.open), rm: vi.fn(original.rm) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(link).mockReset().mockImplementation(original.link);
  vi.mocked(open).mockReset().mockImplementation(original.open);
  vi.mocked(rm).mockReset().mockImplementation(original.rm);
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
  it('keeps a failed partial write private and preserves the primary write failure', async () => {
    const f = await fixture();
    const failure = new Error('Fictional disk-full failure');
    vi.spyOn(f.prototype, 'writeFile').mockImplementation(async function (this: FileHandle) {
      await f.original.call(this, 'partial', 'utf8');
      await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
      throw failure;
    });
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(f.directory)).toEqual(['probe']);
  });

  it('does not remove another owner publication when its staged write fails', async () => {
    const f = await fixture();
    const failure = new Error('Fictional write interruption');
    vi.spyOn(f.prototype, 'writeFile').mockImplementation(async function (this: FileHandle) {
      await f.original.call(this, 'partial', 'utf8');
      const replacement = await open(f.destination, 'wx');
      try { await f.original.call(replacement, 'Other owner', 'utf8'); }
      finally { await replacement.close(); }
      throw failure;
    });
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    expect(await readFile(f.destination, 'utf8')).toBe('Other owner');
  });

  it('publishes only completed data with private permissions and cleans its staging directory', async () => {
    const f = await fixture();
    vi.spyOn(f.prototype, 'writeFile').mockImplementation(async function (this: FileHandle, contents) {
      await f.original.call(this, contents, 'utf8');
      await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
      const names = await readdir(f.directory);
      const staging = names.find(name => name !== 'probe');
      expect(staging).toBeDefined();
      if (staging === undefined) throw new Error('Expected a private staging directory');
      expect((await lstat(join(f.directory, staging))).mode & 0o777).toBe(0o700);
    });
    await writeNewOutput(f.destination, 'complete');
    expect(await readFile(f.destination, 'utf8')).toBe('complete');
    expect((await lstat(f.destination)).mode & 0o777).toBe(0o600);
    expect((await readdir(f.directory)).sort()).toEqual(['graph.jsonld', 'probe']);
  });

  it('atomically refuses another owner publication after staging completes', async () => {
    const f = await fixture();
    vi.spyOn(f.prototype, 'writeFile').mockImplementation(async function (this: FileHandle, contents) {
      await f.original.call(this, contents, 'utf8');
      const replacement = await open(f.destination, 'wx');
      try { await f.original.call(replacement, 'Other owner', 'utf8'); }
      finally { await replacement.close(); }
    });
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(f.destination, 'utf8')).toBe('Other owner');
    expect((await readdir(f.directory)).sort()).toEqual(['graph.jsonld', 'probe']);
  });

  it('fails closed when atomic hard-link publication is unsupported', async () => {
    const f = await fixture();
    const failure = Object.assign(new Error('Fictional filesystem cannot hard-link'), { code: 'ENOTSUP' });
    vi.mocked(link).mockRejectedValueOnce(failure);
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(f.directory)).toEqual(['probe']);
  });

  it('preserves a primary write failure even when closing the staged handle also fails', async () => {
    const f = await fixture();
    const primary = new Error('Fictional primary write failure');
    const secondary = new Error('Fictional secondary close failure');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); throw secondary; });
      return handle;
    });
    vi.spyOn(f.prototype, 'writeFile').mockRejectedValueOnce(primary);
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(primary);
    await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(f.directory)).toEqual(['probe']);
  });

  it('reports staged-handle close failure without publishing the completed data', async () => {
    const f = await fixture();
    const failure = new Error('Fictional close failure');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); throw failure; });
      return handle;
    });
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    await expect(lstat(f.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(f.directory)).toEqual(['probe']);
  });

  it('reports staging cleanup failure without removing the completed published destination', async () => {
    const f = await fixture();
    const failure = new Error('Fictional staging cleanup failure');
    vi.mocked(rm).mockRejectedValueOnce(failure);
    await expect(writeNewOutput(f.destination, 'complete')).rejects.toBe(failure);
    expect(await readFile(f.destination, 'utf8')).toBe('complete');
    const staging = (await readdir(f.directory)).find(name => name !== 'probe' && name !== 'graph.jsonld');
    if (staging === undefined) throw new Error('Expected retained private staging after cleanup failure');
    expect((await lstat(join(f.directory, staging))).mode & 0o777).toBe(0o700);
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
