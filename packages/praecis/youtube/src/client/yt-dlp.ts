import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Result } from './types.js';
import type { Transcript } from '../schema/index.js';
import {
  parseTranscriptJson,
  parseTranscriptTtml,
  parseTranscriptVtt,
} from './transcript.js';

const execFileAsync = promisify(execFile);

// ── Runtime Config ───────────────────────────────────────────────────────────

/** Configuration for the yt-dlp client, typically derived from ResolvedConfig. */
export interface YtDlpRuntimeConfig {
  bin: string;
  jsRuntimes: string;
  cookiesFile?: string;
  remoteComponents?: string;
  timeoutMs: number;
  keepFiles: boolean;
  debugTranscript: boolean;
}

/** Default runtime config (no environment-variable lookup). */
export function ytDlpDefaultConfig(): YtDlpRuntimeConfig {
  return {
    bin: 'yt-dlp',
    jsRuntimes: 'node',
    remoteComponents: '',
    timeoutMs: 120000,
    keepFiles: false,
    debugTranscript: false,
  };
}

/** Build a YtDlpRuntimeConfig from process.env (legacy/fallback). */
export function ytDlpConfigFromEnv(): YtDlpRuntimeConfig {
  const jsConfigured =
    process.env['AIDHA_YTDLP_JS_RUNTIMES'] ??
    process.env['YTDLP_JS_RUNTIMES'] ??
    'node';
  const parsed = Number.parseInt(process.env['AIDHA_YTDLP_TIMEOUT_MS'] ?? '120000', 10);
  return {
    bin:
      process.env['AIDHA_YTDLP_BIN'] ??
      process.env['YTDLP_BIN'] ??
      'yt-dlp',
    jsRuntimes: jsConfigured.trim() || 'node',
    cookiesFile:
      process.env['AIDHA_YTDLP_COOKIES_FILE'] ??
      process.env['YTDLP_COOKIES_FILE'] ??
      process.env['YTDLP_COOKIES'],
    remoteComponents:
      process.env['AIDHA_YTDLP_REMOTE_COMPONENTS'] ??
      process.env['YTDLP_REMOTE_COMPONENTS'] ??
      '',
    timeoutMs: Number.isNaN(parsed) ? 120000 : parsed,
    keepFiles: process.env['AIDHA_YTDLP_KEEP_FILES'] === '1',
    debugTranscript: process.env['AIDHA_DEBUG_TRANSCRIPT'] === '1',
  };
}

const FORMAT_PRIORITY = ['.vtt', '.ttml', '.json3', '.json'];

export interface ToolingCheck {
  executable: string;
  available: boolean;
  status: 'ok' | 'warn' | 'error';
  message?: string;
}

export interface YtDlpEnvironmentDiagnosis {
  ytdlp: Omit<ToolingCheck, 'status'> & { status: 'ok' | 'error' };
  jsRuntime: ToolingCheck & { configured: string };
  ffmpeg: ToolingCheck;
}

export interface YtDlpPreflightProbe {
  attempted: boolean;
  url?: string;
  ok: boolean;
  message?: string;
}

export interface YtDlpPreflightRuntime {
  label: string;
  executable: string;
  available: boolean;
  version?: string;
}

export interface YtDlpPreflightReport {
  ytdlp: {
    executable: string;
    available: boolean;
    version?: string;
    status: 'ok' | 'error';
    message?: string;
  };
  jsRuntime: {
    configured: string;
    availableAny: boolean;
    runtimes: YtDlpPreflightRuntime[];
  };
  ffmpeg: ToolingCheck;
  probe: YtDlpPreflightProbe;
}

function parseRuntimeExecutable(configured: string): string {
  const first = configured.split(',')[0]?.trim() ?? '';
  if (!first) return 'node';
  const pathCandidate = first.split(':')[1]?.trim();
  if (pathCandidate) return pathCandidate;
  return first;
}

async function checkExecutable(executable: string): Promise<boolean> {
  try {
    await execFileAsync(executable, ['--version'], {
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function readVersion(executable: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(executable, ['--version'], {
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
    const firstLine = stdout.split('\n').map(line => line.trim()).find(Boolean);
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

export function parseConfiguredRuntimes(configured: string): YtDlpPreflightRuntime[] {
  const parts = configured
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  const entries = parts.map(part => {
    const trimmed = part.trim();
    const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(trimmed);
    if (windowsAbsolute) {
      return {
        label: trimmed,
        executable: trimmed,
        available: false,
      };
    }
    const splitIndex = trimmed.indexOf(':');
    const label = splitIndex === -1 ? trimmed : trimmed.slice(0, splitIndex).trim() || trimmed;
    const executable = splitIndex === -1 ? label : trimmed.slice(splitIndex + 1).trim() || label;
    return {
      label,
      executable,
      available: false,
    };
  });

  for (const common of ['node', 'deno', 'bun']) {
    if (!entries.some(entry => entry.label === common || entry.executable === common)) {
      entries.push({ label: common, executable: common, available: false });
    }
  }
  return entries;
}

export async function diagnoseYtDlpEnvironment(
  rtConfig?: YtDlpRuntimeConfig,
): Promise<Result<YtDlpEnvironmentDiagnosis>> {
  const cfg = rtConfig ?? ytDlpDefaultConfig();
  const ytdlpExecutable = cfg.bin;
  const jsConfigured = cfg.jsRuntimes;
  const jsExecutable = parseRuntimeExecutable(jsConfigured);

  const [ytdlpAvailable, jsAvailable, ffmpegAvailable] = await Promise.all([
    checkExecutable(ytdlpExecutable),
    checkExecutable(jsExecutable),
    checkExecutable('ffmpeg'),
  ]);

  return {
    ok: true,
    value: {
      ytdlp: {
        executable: ytdlpExecutable,
        available: ytdlpAvailable,
        status: ytdlpAvailable ? 'ok' : 'error',
        message: ytdlpAvailable ? undefined : 'yt-dlp binary not found or not executable.',
      },
      jsRuntime: {
        configured: jsConfigured,
        executable: jsExecutable,
        available: jsAvailable,
        status: jsAvailable ? 'ok' : 'error',
        message: jsAvailable
          ? undefined
          : 'No supported JavaScript runtime found for yt-dlp; set --ytdlp-js-runtimes or AIDHA_YTDLP_JS_RUNTIMES.',
      },
      ffmpeg: {
        executable: 'ffmpeg',
        available: ffmpegAvailable,
        status: ffmpegAvailable ? 'ok' : 'warn',
        message: ffmpegAvailable
          ? undefined
          : 'ffmpeg not found; the downloaded format may not be the best available.',
      },
    },
  };
}

export interface YtDlpPreflightOptions {
  probeUrl?: string;
}

export async function runYtDlpPreflight(
  options: YtDlpPreflightOptions = {},
  rtConfig?: YtDlpRuntimeConfig,
): Promise<Result<YtDlpPreflightReport>> {
  const cfg = rtConfig ?? ytDlpDefaultConfig();
  const envResult = await diagnoseYtDlpEnvironment(cfg);
  if (!envResult.ok) return envResult;

  const env = envResult.value;
  const runtimeCandidates = parseConfiguredRuntimes(env.jsRuntime.configured);
  const runtimeChecks = await Promise.all(runtimeCandidates.map(async runtime => {
    const available = await checkExecutable(runtime.executable);
    const version = available ? await readVersion(runtime.executable) : undefined;
    return {
      ...runtime,
      available,
      version,
    };
  }));

  const ytdlpVersion = env.ytdlp.available
    ? await readVersion(env.ytdlp.executable)
    : undefined;

  let probe: YtDlpPreflightProbe = {
    attempted: false,
    ok: false,
  };
  if (options.probeUrl) {
    probe = {
      attempted: true,
      url: options.probeUrl,
      ok: false,
    };
    if (!env.ytdlp.available) {
      probe.message = 'yt-dlp is unavailable; skipping probe.';
    } else {
      try {
        await execFileAsync(env.ytdlp.executable, [
          '--skip-download',
          '--dump-single-json',
          '--no-warnings',
          '--js-runtimes',
          env.jsRuntime.configured,
          options.probeUrl,
        ], {
          timeout: cfg.timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
        });
        probe.ok = true;
      } catch (error) {
        probe.ok = false;
        probe.message = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    ok: true,
    value: {
      ytdlp: {
        executable: env.ytdlp.executable,
        available: env.ytdlp.available,
        version: ytdlpVersion,
        status: env.ytdlp.status,
        message: env.ytdlp.message,
      },
      jsRuntime: {
        configured: env.jsRuntime.configured,
        availableAny: runtimeChecks.some(runtime => runtime.available),
        runtimes: runtimeChecks,
      },
      ffmpeg: env.ffmpeg,
      probe,
    },
  };
}

function detectLanguageFromFilename(filePath: string): string | undefined {
  const name = basename(filePath);
  const match = name.match(/\.([a-z]{2,3}(?:-[A-Za-z]{2})?)\.(vtt|ttml|json3|json)$/);
  return match?.[1];
}

function extractVideoIdFromFilename(filePath: string): string | undefined {
  const name = basename(filePath);
  const candidate = name.split('.')[0];
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function parseVideoIdFromInput(value: string): string | undefined {
  if (!value) return undefined;
  if (!value.includes('/') && !value.includes('.')) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.searchParams.has('v')) {
      return url.searchParams.get('v') ?? undefined;
    }
    if (url.hostname === 'youtu.be') {
      return url.pathname.slice(1) || undefined;
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.slice(7) || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function orderSubtitleFiles(files: string[]): string[] {
  const scored = files.map(file => {
    const ext = extname(file).toLowerCase();
    const score = FORMAT_PRIORITY.indexOf(ext);
    return { file, score: score === -1 ? FORMAT_PRIORITY.length : score };
  });
  return scored.sort((a, b) => a.score - b.score).map(item => item.file);
}

async function parseSubtitleFile(filePath: string): Promise<{ segments: Transcript['segments']; language?: string }> {
  const payload = await fs.readFile(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();
  let segments: Transcript['segments'] = [];
  if (ext === '.vtt') {
    segments = parseTranscriptVtt(payload);
  } else if (ext === '.ttml' || ext === '.xml') {
    segments = parseTranscriptTtml(payload);
  } else if (ext === '.json3' || ext === '.json') {
    segments = parseTranscriptJson(payload);
  }
  return { segments, language: detectLanguageFromFilename(filePath) };
}

function transcriptCoverageScore(segments: Transcript['segments']): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  if (!last) return 0;
  const end = last.start + last.duration;
  return (end * 1_000) + segments.length;
}

export async function fetchTranscriptWithYtDlp(
  videoIdOrUrl: string,
  rtConfig?: YtDlpRuntimeConfig,
): Promise<Result<Transcript>> {
  const cfg = rtConfig ?? ytDlpDefaultConfig();
  let tmpPath: string | null = null;
  try {
    tmpPath = await fs.mkdtemp(join(tmpdir(), 'aidha-ytdlp-'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: new Error(`Failed to create temp directory: ${message}`) };
  }
  if (!tmpPath) {
    return { ok: false, error: new Error('Failed to create temp directory') };
  }
  const outputTemplate = join(tmpPath, '%(id)s.%(ext)s');
  const args = [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--ignore-errors',
    '--sub-langs',
    'en.*,en',
    '--sub-format',
    'vtt/ttml/json3',
    '--no-progress',
    '--output',
    outputTemplate,
  ];

  args.push('--js-runtimes', cfg.jsRuntimes);

  if (cfg.remoteComponents) {
    args.push('--remote-components', cfg.remoteComponents);
  }

  const cookiesFile = cfg.cookiesFile;
  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  }

  args.push(videoIdOrUrl);

  try {
    if (cfg.debugTranscript) {
      // eslint-disable-next-line no-console
      console.log(`[transcript] yt-dlp: ${cfg.bin} ${args.join(' ')}`);
    }

    await execFileAsync(cfg.bin, args, {
      timeout: cfg.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    const files = (await fs.readdir(tmpPath!))
      .filter(name => FORMAT_PRIORITY.includes(extname(name).toLowerCase()))
      .map(name => join(tmpPath!, name));

    const ordered = orderSubtitleFiles(files);
    let bestTranscript: Transcript | null = null;
    let bestScore = -1;
    for (const file of ordered) {
      const { segments, language } = await parseSubtitleFile(file);
      if (segments.length === 0) {
        continue;
      }
      const extractedId =
        extractVideoIdFromFilename(file) ??
        parseVideoIdFromInput(videoIdOrUrl) ??
        videoIdOrUrl;
      const transcript: Transcript = {
        videoId: extractedId,
        language: language ?? 'en',
        segments,
        fullText: segments.map(segment => segment.text).join(' '),
      };
      const score = transcriptCoverageScore(segments);
      if (score > bestScore) {
        bestScore = score;
        bestTranscript = transcript;
      }
    }

    if (bestTranscript) {
      return { ok: true, value: bestTranscript };
    }

    return { ok: false, error: new Error('yt-dlp did not produce subtitles') };
  } catch (error) {
    const message =
      error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'yt-dlp not found. Install yt-dlp or set AIDHA_YTDLP_BIN.'
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, error: new Error(message) };
  } finally {
    if (tmpPath) {
      if (!cfg.keepFiles) {
        try {
          await fs.rm(tmpPath, { recursive: true, force: true });
        } catch (error) {
          if (cfg.debugTranscript) {
            const message = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console
            console.log(`[transcript] cleanup warning: ${message}`);
          }
        }
      } else if (cfg.debugTranscript) {
        // eslint-disable-next-line no-console
        console.log(`[transcript] yt-dlp files kept at ${tmpPath}`);
      }
    }
  }
}
