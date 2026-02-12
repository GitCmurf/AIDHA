import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { isCliEntrypoint } from '../src/cli.js';

describe('isCliEntrypoint', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidha-cli-entrypoint-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('treats symlink argv[1] as direct execution of the real CLI file', () => {
    const realCli = join(root, 'dist', 'cli.js');
    const binDir = join(root, 'node_modules', '.bin');
    const binLink = join(binDir, 'aidha-youtube');

    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(realCli, '#!/usr/bin/env node\n', 'utf-8');
    symlinkSync(realCli, binLink);

    const mainUrl = pathToFileURL(realCli).href;
    expect(isCliEntrypoint(mainUrl, binLink)).toBe(true);
  });

  it('returns false when argv[1] points to a different script', () => {
    const realCli = resolve(root, 'dist', 'cli.js');
    const other = resolve(root, 'dist', 'other.js');
    mkdirSync(resolve(root, 'dist'), { recursive: true });
    writeFileSync(realCli, '#!/usr/bin/env node\n', 'utf-8');
    writeFileSync(other, '#!/usr/bin/env node\n', 'utf-8');

    const mainUrl = pathToFileURL(realCli).href;
    expect(isCliEntrypoint(mainUrl, other)).toBe(false);
  });
});
