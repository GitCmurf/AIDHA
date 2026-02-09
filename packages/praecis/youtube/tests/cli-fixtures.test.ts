import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

describe('CLI fixtures import-ttml', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-fixtures-cli-'));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('imports TTML into normalized excerpt JSON fixture', async () => {
    const ttmlPath = join(tempRoot, 'video123.en-orig.ttml');
    const outPath = join(tempRoot, 'video123.excerpts.json');
    await writeFile(
      ttmlPath,
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<tt xmlns="http://www.w3.org/ns/ttml">',
        '  <body><div>',
        '    <p begin="0.0s" dur="1.0s">First line</p>',
        '    <p begin="2.0s" dur="2.0s">Second line</p>',
        '  </div></body>',
        '</tt>',
      ].join('\n'),
      'utf-8'
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runCli([
      'fixtures',
      'import-ttml',
      ttmlPath,
      '--out',
      outPath,
      '--video-id',
      'video123',
      '--source-url',
      'https://www.youtube.com/watch?v=video123',
    ]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    expect(code).toBe(0);
    const output = JSON.parse(await readFile(outPath, 'utf-8')) as {
      fixtureVersion: number;
      videoId: string;
      segmentCount: number;
      segments: Array<{ id: string; start: number; duration: number; text: string }>;
      transcriptHash: string;
    };
    expect(output.fixtureVersion).toBe(1);
    expect(output.videoId).toBe('video123');
    expect(output.segmentCount).toBe(2);
    expect(output.segments[0]?.id).toBe('fixture-video123-0');
    expect(output.segments[1]?.text).toBe('Second line');
    expect(output.transcriptHash.length).toBeGreaterThan(10);
  });

  it('fails with usage when path is missing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runCli(['fixtures', 'import-ttml']);
    expect(code).toBe(1);
    const errors = errSpy.mock.calls.map(call => String(call[0] ?? '')).join('\n');
    expect(errors).toContain('Usage: fixtures import-ttml');
    errSpy.mockRestore();
  });
});
