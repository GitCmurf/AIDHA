import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

describe('CLI export flows', () => {
  let tempRoot = '';
  let dbPath = '';
  let originalCwd = '';

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-export-'));
    dbPath = join(tempRoot, 'aidha.sqlite');
  });

  afterEach(async () => {
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('writes accepted and draft dossier files when split-states is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const ingestCode = await runCli(['ingest', 'video', 'test-video', '--db', dbPath, '--mock']);
    const extractCode = await runCli(['extract', 'claims', 'test-video', '--db', dbPath]);
    const outPath = join(tempRoot, 'dossier-test-video.md');
    const exportCode = await runCli([
      'export',
      'dossier',
      'video',
      'test-video',
      '--db',
      dbPath,
      '--out',
      outPath,
      '--split-states',
    ]);

    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(ingestCode).toBe(0);
    expect(extractCode).toBe(0);
    expect(exportCode).toBe(0);

    const acceptedPath = outPath;
    const draftPath = outPath.replace(/\.md$/, '.draft.md');
    expect(existsSync(acceptedPath)).toBe(true);
    expect(existsSync(draftPath)).toBe(true);

    const accepted = await readFile(acceptedPath, 'utf-8');
    const draft = await readFile(draftPath, 'utf-8');
    expect(accepted).toContain('## Claims');
    expect(draft).toContain('## Claims');
  }, 20_000);

  it('exports transcript JSON for a video', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const ingestCode = await runCli(['ingest', 'video', 'test-video', '--db', dbPath, '--mock']);
    const outPath = join(tempRoot, 'transcript-test-video.json');
    const exportCode = await runCli([
      'export',
      'transcript',
      'video',
      'test-video',
      '--db',
      dbPath,
      '--out',
      outPath,
    ]);

    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(ingestCode).toBe(0);
    expect(exportCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);

    const payload = JSON.parse(await readFile(outPath, 'utf-8')) as {
      videoId: string;
      resourceId: string;
      segments: Array<{ id: string; start: number; end: number; duration: number; text: string }>;
    };
    expect(payload.videoId).toBe('test-video');
    expect(payload.resourceId).toBe('youtube-test-video');
    expect(payload.segments.length).toBeGreaterThan(0);
  }, 20_000);

  it('uses source-prefixed default output filenames', async () => {
    process.chdir(tempRoot);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const ingestCode = await runCli(['ingest', 'video', 'test-video', '--db', dbPath, '--mock']);
    const extractCode = await runCli(['extract', 'claims', 'test-video', '--db', dbPath]);
    const exportDefaultCode = await runCli([
      'export',
      'dossier',
      'video',
      'test-video',
      '--db',
      dbPath,
    ]);
    const exportCustomCode = await runCli([
      'export',
      'transcript',
      'video',
      'test-video',
      '--db',
      dbPath,
      '--source-prefix',
      'yt',
    ]);

    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(ingestCode).toBe(0);
    expect(extractCode).toBe(0);
    expect(exportDefaultCode).toBe(0);
    expect(exportCustomCode).toBe(0);

    expect(existsSync(join(tempRoot, 'out', 'dossier-youtube-test-video.md'))).toBe(true);
    expect(existsSync(join(tempRoot, 'out', 'transcript-yt-test-video.json'))).toBe(true);
  }, 20_000);

  it('exports Gephi CSV files with nodes and edges', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const ingestCode = await runCli(['ingest', 'video', 'test-video', '--db', dbPath, '--mock']);
    const extractCode = await runCli(['extract', 'claims', 'test-video', '--db', dbPath]);
    const outDir = join(tempRoot, 'gephi-out');
    const exportCode = await runCli([
      'export',
      'gephi',
      '--db',
      dbPath,
      '--out',
      outDir,
      '--include-labels',
    ]);

    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(ingestCode).toBe(0);
    expect(extractCode).toBe(0);
    expect(exportCode).toBe(0);

    const nodesPath = join(outDir, 'nodes.csv');
    const edgesPath = join(outDir, 'edges.csv');
    expect(existsSync(nodesPath)).toBe(true);
    expect(existsSync(edgesPath)).toBe(true);

    const nodesContent = await readFile(nodesPath, 'utf-8');
    expect(nodesContent).toContain('Id,Label,Type,CreatedAt');
    expect(nodesContent.split('\n').length).toBeGreaterThan(2);

    const edgesContent = await readFile(edgesPath, 'utf-8');
    expect(edgesContent).toContain('Source,Target,Type,Weight,CreatedAt');
  }, 30_000);

  it('runs diagnose stats and returns JSON', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const ingestCode = await runCli(['ingest', 'video', 'test-video', '--db', dbPath, '--mock']);
    const extractCode = await runCli(['extract', 'claims', 'test-video', '--db', dbPath]);
    const statsCode = await runCli([
      'diagnose',
      'stats',
      '--db',
      dbPath,
      '--json',
      '--top',
      '5',
    ]);

    const logCalls = logSpy.mock.calls;
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(ingestCode).toBe(0);
    expect(extractCode).toBe(0);
    expect(statsCode).toBe(0);

    const lastLog = String(logCalls.at(-1)?.[0] ?? '{}');
    const stats = JSON.parse(lastLog) as {
      nodeCounts: Record<string, number>;
      edgeCounts: Record<string, number>;
      topDegreeNodes: Array<{ id: string; type: string }>;
    };
    expect(stats.nodeCounts).toBeDefined();
    expect(stats.edgeCounts).toBeDefined();
    expect(stats.topDegreeNodes.length).toBeLessThanOrEqual(5);
  }, 30_000);
});
