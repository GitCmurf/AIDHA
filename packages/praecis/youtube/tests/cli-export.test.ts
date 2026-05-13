import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';
import { describeIfSqlite } from './test-utils.js';

const CLI_EXPORT_TIMEOUT_MS = 120_000;

describeIfSqlite('CLI export flows', () => {
  let tempRoot = '';
  let dbPath = '';
  let originalCwd = '';
  let originalInitCwd = process.env['INIT_CWD'];

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-export-'));
    dbPath = join(tempRoot, 'aidha.sqlite');
    process.chdir(tempRoot);
    delete process.env['INIT_CWD'];
  }, CLI_EXPORT_TIMEOUT_MS);

  afterEach(async () => {
    if (originalInitCwd === undefined) {
      delete process.env['INIT_CWD'];
    } else {
      process.env['INIT_CWD'] = originalInitCwd;
    }
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (tempRoot) {
      // Retry removal with delay to handle file handle cleanup (e.g., SQLite WAL files)
      for (let i = 0; i < 3; i++) {
        try {
          await rm(tempRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY' && i < 2) {
            // Wait a bit for file handles to close
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }
          throw error;
        }
      }
    }
  }, CLI_EXPORT_TIMEOUT_MS);

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
  }, CLI_EXPORT_TIMEOUT_MS);

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
  }, CLI_EXPORT_TIMEOUT_MS);

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
  }, CLI_EXPORT_TIMEOUT_MS);

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
  }, CLI_EXPORT_TIMEOUT_MS);

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
  }, CLI_EXPORT_TIMEOUT_MS);
});
