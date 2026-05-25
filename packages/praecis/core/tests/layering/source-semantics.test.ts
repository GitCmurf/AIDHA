// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcRoot = join(repoRoot, 'src');

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

describe('core source layering', () => {
  it('does not embed YouTube resource ids or URLs in reusable core code', async () => {
    const offenders: string[] = [];
    for (const path of await listTypeScriptFiles(srcRoot)) {
      const text = await readFile(path, 'utf8');
      if (
        text.includes('youtube.com/watch') ||
        text.includes('video transcripts') ||
        /['"`]youtube-/.test(text)
      ) {
        offenders.push(relative(repoRoot, path));
      }
    }

    expect(offenders).toEqual([]);
  }, 120_000);
});
