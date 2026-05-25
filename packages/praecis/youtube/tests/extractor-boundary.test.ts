import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
const sourceRoot = join(packageRoot, 'src');

async function listTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    if (entry.isFile() && entry.name.endsWith('.ts')) return [path];
    return [];
  }));
  return files.flat();
}

describe('YouTube extraction boundary', () => {
  it('does not carry a local extractor fork', async () => {
    expect(existsSync(join(sourceRoot, 'extract'))).toBe(false);
  });

  it('does not import local extraction modules', async () => {
    const offenders: string[] = [];
    for (const path of await listTypeScriptFiles(sourceRoot)) {
      const text = await readFile(path, 'utf8');
      if (/from ['"](?:\.\/|\.\.\/)+extract(?:\/|['"])/.test(text) || /import\(['"](?:\.\/|\.\.\/)+extract(?:\/|['"])/.test(text)) {
        offenders.push(relative(packageRoot, path));
      }
    }

    expect(offenders).toEqual([]);
  });
});
