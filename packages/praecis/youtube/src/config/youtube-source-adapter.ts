// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * YouTube source adapter — SourceRegistration for the YouTube ingestion vector.
 *
 * Owns the typed runtime shape for YouTube-specific config (yt-dlp, YouTube client),
 * built-in source defaults, validation/narrowing of `activeSourceConfig`,
 * secret redaction, and path resolution.
 *
 * The core `@aidha/config` package never imports this file. The CLI bridge
 * passes this registration to the resolver at startup.
 *
 * @module
 */

import type { SourceRegistration } from '@aidha/config';
import { resolve } from 'node:path';

// ── Source ID ────────────────────────────────────────────────────────────────

export const SOURCE_ID = 'youtube';

// ── Typed Runtime Shapes ────────────────────────────────────────────────────

export interface YtdlpConfig {
  bin: string;
  cookiesFile: string;
  remoteComponents: string;
  timeoutMs: number;
  jsRuntimes: string;
  keepFiles: boolean;
}

export interface YoutubeClientConfig {
  cookie: string;
  innertubeApiKey: string;
  debugTranscript: boolean;
}

export interface ResolvedYoutubeConfig {
  ytdlp: YtdlpConfig;
  youtube: YoutubeClientConfig;
}

// ── Built-in Source Defaults ─────────────────────────────────────────────────

const YOUTUBE_SOURCE_DEFAULTS: Record<string, unknown> = {
  ytdlp: {
    bin: 'yt-dlp',
    cookies_file: '',
    remote_components: '',
    timeout_ms: 120_000,
    js_runtimes: '',
    keep_files: false,
  },
  youtube: {
    cookie: '',
    innertube_api_key: '',
    debug_transcript: false,
  },
  extraction: {
    chunk_minutes: 5,
    max_claims: 15,
  },
};

// ── Validation / Narrowing ───────────────────────────────────────────────────

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function narrowYtdlp(raw: unknown): YtdlpConfig {
  if (raw === null || typeof raw !== 'object') {
    return {
      bin: 'yt-dlp',
      cookiesFile: '',
      remoteComponents: '',
      timeoutMs: 120_000,
      jsRuntimes: '',
      keepFiles: false,
    };
  }
  const obj = raw as Record<string, unknown>;
  return {
    bin: toString(obj['bin'], 'yt-dlp'),
    cookiesFile: toString(obj['cookies_file'], ''),
    remoteComponents: toString(obj['remote_components'], ''),
    timeoutMs: toNumber(obj['timeout_ms'], 120_000),
    jsRuntimes: toString(obj['js_runtimes'], ''),
    keepFiles: toBoolean(obj['keep_files'], false),
  };
}

function narrowYoutube(raw: unknown): YoutubeClientConfig {
  if (raw === null || typeof raw !== 'object') {
    return {
      cookie: '',
      innertubeApiKey: '',
      debugTranscript: false,
    };
  }
  const obj = raw as Record<string, unknown>;
  return {
    cookie: toString(obj['cookie'], ''),
    innertubeApiKey: toString(obj['innertube_api_key'], ''),
    debugTranscript: toBoolean(obj['debug_transcript'], false),
  };
}

// ── Source Registration ─────────────────────────────────────────────────────

export const YouTubeSourceRegistration: SourceRegistration<ResolvedYoutubeConfig> = {
  sourceId: SOURCE_ID,
  defaults: YOUTUBE_SOURCE_DEFAULTS,
  metadata: {
    pathFields: ['ytdlp.cookies_file'],
    secretFields: ['youtube.cookie', 'youtube.innertube_api_key'],
    scalarCoercions: {
      'ytdlp.timeout_ms': 'number',
      'ytdlp.keep_files': 'boolean',
      'youtube.debug_transcript': 'boolean',
    },
    explainLabels: {
      'ytdlp.bin': 'Path to yt-dlp binary',
      'ytdlp.cookies_file': 'Path to cookies file for yt-dlp',
      'ytdlp.timeout_ms': 'yt-dlp process timeout in milliseconds',
      'youtube.cookie': 'YouTube authentication cookie', // pragma: allowlist secret
      'youtube.innertube_api_key': 'YouTube Innertube API key', // pragma: allowlist secret
    },
  },

  validateActiveSourceConfig(value: unknown): ResolvedYoutubeConfig {
    if (value === null || typeof value !== 'object') {
      return {
        ytdlp: narrowYtdlp(null),
        youtube: narrowYoutube(null),
      };
    }
    const obj = value as Record<string, unknown>;
    return {
      ytdlp: narrowYtdlp(obj['ytdlp']),
      youtube: narrowYoutube(obj['youtube']),
    };
  },

  redactActiveSourceConfig(value: ResolvedYoutubeConfig): unknown {
    return {
      ...value,
      youtube: {
        ...value.youtube,
        cookie: '********',
        innertubeApiKey: value.youtube.innertubeApiKey ? '********' : '',
      },
    };
  },

  resolveSourcePaths(value: ResolvedYoutubeConfig, baseDir: string): ResolvedYoutubeConfig {
    const isBareCommand = (v: string): boolean =>
      v !== '' && !v.includes('/') && !v.includes('\\');

    return {
      ...value,
      ytdlp: {
        ...value.ytdlp,
        bin: isBareCommand(value.ytdlp.bin) ? value.ytdlp.bin : resolve(baseDir, value.ytdlp.bin),
        cookiesFile: value.ytdlp.cookiesFile === '' ? '' : resolve(baseDir, value.ytdlp.cookiesFile),
      },
    };
  },

  cliBindings: [
    { command: 'ingest video', selectsSourceByDefault: true },
    { command: 'extract claims', selectsSourceByDefault: true },
    { command: 'diagnose transcript', selectsSourceByDefault: true },
    { command: 'diagnose extract', selectsSourceByDefault: true },
    { command: 'diagnose editor', selectsSourceByDefault: true },
  ],
};
