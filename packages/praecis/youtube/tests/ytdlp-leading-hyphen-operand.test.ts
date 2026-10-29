import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealYouTubeClient } from '../src/client/youtube.js';
import type { YtDlpRuntimeConfig } from '../src/client/yt-dlp.js';

const leadingHyphenId = '-wRHXXyR6sc';

describe('yt-dlp fallback positional argument boundary', () => {
  let scriptDir: string;
  let scriptPath: string;
  let argsPath: string;
  let cookiePath: string;
  let config: YtDlpRuntimeConfig;

  beforeEach(async () => {
    scriptDir = await fs.mkdtemp(join(tmpdir(), 'aidha-ytdlp-operand-'));
    scriptPath = join(scriptDir, 'yt-dlp-fixture');
    argsPath = join(scriptDir, 'args.txt');
    cookiePath = join(scriptDir, 'fictional-cookies.txt');
    await fs.copyFile(new URL('./fixtures/ytdlp-leading-hyphen.sh', import.meta.url), scriptPath);
    await fs.chmod(scriptPath, 0o755);
    config = {
      bin: scriptPath,
      jsRuntimes: 'node',
      cookiesFile: cookiePath,
      remoteComponents: 'ejs:github',
      timeoutMs: 5_000,
      keepFiles: false,
      debugTranscript: false,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('offline fixture miss', { status: 404 })));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(scriptDir, { recursive: true, force: true });
  });

  it.each([
    ['raw video ID', leadingHyphenId],
    ['equivalent watch URL', `https://www.youtube.com/watch?v=${leadingHyphenId}`],
  ])('passes a leading-hyphen %s after the option terminator', async (_label, input) => {
    const client = new RealYouTubeClient({ debugTranscript: false }, config);
    const result = await client.fetchTranscript(input);

    const capturedArgv = await fs.readFile(argsPath, 'utf8').catch(() => '<fake downloader was not invoked>');
    expect(result.ok, `${result.ok ? '' : result.error.message}\nargv:\n${capturedArgv}`).toBe(true);
    if (!result.ok) return;
    expect(result.value.videoId).toBe(leadingHyphenId);
    expect(result.value.fullText).toContain('Fictional transcript fixture');

    const args = (await fs.readFile(argsPath, 'utf8')).trimEnd().split('\n');
    const separatorIndex = args.indexOf('--');
    expect(separatorIndex).toBeGreaterThan(-1);
    expect(args.slice(0, separatorIndex)).toEqual(expect.arrayContaining([
      '--js-runtimes', 'node', '--remote-components', 'ejs:github', '--cookies', cookiePath,
    ]));
    expect(args.slice(separatorIndex)).toEqual(['--', leadingHyphenId]);
  });
});
