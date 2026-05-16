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
import { ConfigValidationError } from '@aidha/config';
import { resolve } from 'node:path';
import { resolvePathValue } from '@aidha/config';

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

const YOUTUBE_SOURCE_SCALAR_COERCIONS: Readonly<Record<string, 'number' | 'boolean' | 'string'>> = {
  'ytdlp.bin': 'string',
  'ytdlp.cookies_file': 'string',
  'ytdlp.remote_components': 'string',
  'ytdlp.timeout_ms': 'number',
  'ytdlp.js_runtimes': 'string',
  'ytdlp.keep_files': 'boolean',
  'youtube.cookie': 'string',
  'youtube.innertube_api_key': 'string', // pragma: allowlist secret
  'youtube.debug_transcript': 'boolean',
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

function clonePlainObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => clonePlainObject(item)) as T;
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = clonePlainObject(entry);
    }
    return result as T;
  }

  return value;
}

function getNestedValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = target;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const replacement: Record<string, unknown> = {};
      current[part] = replacement;
      current = replacement;
      continue;
    }

    const nested = next as Record<string, unknown>;
    current = nested;
  }

  const leaf = parts.at(-1);
  if (leaf === undefined) {
    return;
  }

  current[leaf] = value;
}

function parseBooleanScalar(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function coerceScalarValue(
  value: unknown,
  kind: 'number' | 'boolean' | 'string',
  path: string,
): { value?: unknown; issue?: { path: string; message: string } } {
  if (kind === 'string') {
    if (typeof value === 'string') {
      return { value };
    }
    return {
      issue: {
        path,
        message: `Expected a string, got ${value === null ? 'null' : typeof value}`,
      },
    };
  }

  if (kind === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { value };
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (value.trim().length > 0 && Number.isFinite(parsed)) {
        return { value: parsed };
      }
    }
    return {
      issue: {
        path,
        message: `Expected a number or numeric string, got ${JSON.stringify(value)}`,
      },
    };
  }

  if (typeof value === 'boolean') {
    return { value };
  }

  if (typeof value === 'string') {
    const parsed = parseBooleanScalar(value);
    if (parsed !== null) {
      return { value: parsed };
    }
  }

  return {
    issue: {
      path,
      message: `Expected a boolean or boolean string, got ${JSON.stringify(value)}`,
    },
  };
}

function applyScalarCoercions(raw: Record<string, unknown>): Record<string, unknown> {
  const coerced = clonePlainObject(raw);
  const issues: Array<{ path: string; message: string }> = [];

  for (const [path, kind] of Object.entries(YOUTUBE_SOURCE_SCALAR_COERCIONS)) {
    const current = getNestedValue(coerced, path);
    if (current === undefined) continue;

    const result = coerceScalarValue(current, kind, path);
    if (result.issue) {
      issues.push(result.issue);
      continue;
    }

    setNestedValue(coerced, path, result.value);
  }

  if (issues.length > 0) {
    throw new ConfigValidationError('source_overrides.youtube', issues);
  }

  return coerced;
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
    const obj = applyScalarCoercions(value as Record<string, unknown>);
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
    return {
      ...value,
      ytdlp: {
        ...value.ytdlp,
        bin: resolvePathValue(value.ytdlp.bin, baseDir),
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
