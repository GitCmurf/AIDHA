import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

describe('CLI preflight and help routing', () => {
  let tempRoot = '';
  let ytdlpScript = '';
  let runtimeScript = '';
  let ytdlpLogPath = '';
  let originalPath = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-preflight-'));
    ytdlpScript = join(tempRoot, 'yt-dlp');
    runtimeScript = join(tempRoot, 'node-runtime');
    ytdlpLogPath = join(tempRoot, 'ytdlp.log');
    originalPath = process.env['PATH'] ?? '';

    const ytdlpBody = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `log_path="${ytdlpLogPath}"`,
      'printf "%s\\n" "$*" >> "$log_path"',
      'if [[ "${1:-}" == "--version" ]]; then',
      '    echo "2026.01.01"',
      '    exit 0',
      'fi',
      'for arg in "$@"; do',
      '    if [[ "$arg" == "--dump-single-json" ]]; then',
      '        echo "{\\"id\\":\\"probe-video\\",\\"title\\":\\"Probe Title\\"}"',
      '        exit 0',
      '    fi',
      'done',
      'exit 0',
    ].join('\n');
    await writeFile(ytdlpScript, ytdlpBody, 'utf-8');
    await chmod(ytdlpScript, 0o755);

    const runtimeBody = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "${1:-}" == "--version" ]]; then',
      '    echo "v22.0.0-test"',
      '    exit 0',
      'fi',
      'exit 0',
    ].join('\n');
    await writeFile(runtimeScript, runtimeBody, 'utf-8');
    await chmod(runtimeScript, 0o755);

    for (const tool of ['deno', 'bun', 'ffmpeg']) {
      const toolPath = join(tempRoot, tool);
      const toolBody = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [[ "${1:-}" == "--version" ]]; then',
        `    echo "${tool}-test-1.0.0"`,
        '    exit 0',
        'fi',
        'exit 0',
      ].join('\n');
      await writeFile(toolPath, toolBody, 'utf-8');
      await chmod(toolPath, 0o755);
    }

    process.env['PATH'] = `${tempRoot}:${originalPath}`;
  });

  afterEach(async () => {
    process.env['PATH'] = originalPath;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('supports subcommand help via --help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runCli(['query', '--help']);

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map(call => String(call[0] ?? '')).join('\n');
    expect(output).toContain('AIDHA YouTube CLI');
    expect(output).toContain('aidha-youtube query <text...>');
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('runs preflight youtube and optional probe-url', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runCli([
      'preflight',
      'youtube',
      '--json',
      '--probe-url',
      'https://www.youtube.com/watch?v=probe-video',
      '--ytdlp-bin',
      ytdlpScript,
      '--ytdlp-js-runtimes',
      `node:${runtimeScript}`,
    ]);

    expect(code).toBe(0);
    expect(errSpy).not.toHaveBeenCalled();
    const outputText = String(logSpy.mock.calls.at(-1)?.[0] ?? '{}');
    const parsed = JSON.parse(outputText) as {
      ytdlp: { version?: string };
      jsRuntime: { availableAny: boolean };
      probe?: { attempted: boolean; ok: boolean };
    };
    expect(parsed.ytdlp.version).toBe('2026.01.01');
    expect(parsed.jsRuntime.availableAny).toBe(true);
    expect(parsed.probe?.attempted).toBe(true);
    expect(parsed.probe?.ok).toBe(true);

    const logContent = await readFile(ytdlpLogPath, 'utf-8');
    expect(logContent).toContain('--dump-single-json');

    logSpy.mockRestore();
    errSpy.mockRestore();
  }, 40_000);
});
