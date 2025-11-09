// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Five-tier configuration resolver.
 *
 * Merges configuration from five tiers (CLI → profile → source → default → hardcoded)
 * into a single `ResolvedConfig` consumed by application code.
 *
 * Merge semantics:
 *   - Scalars: higher tier wins.
 *   - Objects: deep-merge (recursive).
 *   - Arrays: higher tier replaces entirely (no concatenation).
 *
 * @module
 */

import type {
  AidhaConfig,
  Profile,
  ResolvedConfig,
} from './types.js';
import { DEFAULTS } from './defaults.js';
import { resolvePathValue } from './paths.js';

// ── Deep merge helper ────────────────────────────────────────────────────────

/**
 * Recursive partial type.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Deep-merge `source` into `target`. Arrays are replaced, not concatenated.
 * Returns a new object (does not mutate inputs).
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: DeepPartial<T>,
): T {
  const result = { ...target } as Record<string, unknown>;
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  for (const [key, srcVal] of Object.entries(source)) {
    if (srcVal === undefined || UNSAFE_KEYS.has(key)) continue;

    const tgtVal = result[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      // Recursive merge for plain objects
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      // Scalars and arrays: source wins
      result[key] = srcVal;
    }
  }

  return result as T;
}

// ── Profile to flat config mapping ───────────────────────────────────────────

/**
 * Convert a `Profile` (with optional sections) into a flat record
 * suitable for merging. Missing sections are omitted.
 */
function profileToFlat(profile: Profile): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (profile.db !== undefined) flat['db'] = profile.db;
  if (profile.llm) flat['llm'] = { ...profile.llm };
  if (profile.editor) flat['editor'] = { ...profile.editor };
  if (profile.extraction) flat['extraction'] = { ...profile.extraction };
  if (profile.export) flat['export'] = { ...profile.export };
  if (profile.ytdlp) flat['ytdlp'] = { ...profile.ytdlp };
  if (profile.youtube) flat['youtube'] = { ...profile.youtube };
  if (profile.rss) flat['rss'] = { ...profile.rss };
  if (profile.extensions) flat['extensions'] = { ...profile.extensions };
  return flat;
}

// ── Main resolver ────────────────────────────────────────────────────────────

/** Options for config resolution. */
export interface ResolveOptions {
  /** CLI flag overrides (Tier 1). Partial profile shape. */
  cliOverrides?: Partial<Profile>;
  /** Named profile to activate (Tier 2). */
  profileName?: string;
  /** Ingestion source ID (Tier 3). */
  sourceId?: string;
  /** The parsed config file (Tiers 2–4). Null if no config file found. */
  rawConfig?: AidhaConfig | null;
  /** The base directory for the resolved config. */
  baseDir?: string;
}

/**
 * Resolve configuration by merging five tiers:
 *
 *   1. Explicit CLI flags/options
 *   2. Active named profile
 *   3. Ingestion-source defaults
 *   4. System-wide default profile
 *   5. Hardcoded fallback defaults (DEFAULTS)
 *
 * @returns A fully-resolved `ResolvedConfig`.
 */
export function resolveConfig(options: ResolveOptions = {}): ResolvedConfig {
  const {
    cliOverrides,
    profileName,
    sourceId,
    rawConfig,
    baseDir = process.cwd(),
  } = options;

  // ── Tier 5: Hardcoded defaults ──────────────────────────────────────
  const defaultProfile = DEFAULTS.profiles?.['default'];
  if (!defaultProfile) {
    throw new Error('Hardcoded DEFAULTS is missing required profiles.default');
  }
  const defaultSourceDefaults = sourceId ? DEFAULTS.sources?.[sourceId] : undefined;
  let merged = profileToFlat(defaultProfile as Profile);

  // Merge hardcoded source defaults under the system default
  if (defaultSourceDefaults) {
    merged = deepMerge(merged, profileToFlat(defaultSourceDefaults as Profile));
  }

  // ── Tier 4: System-wide default profile from config file ────────────
  if (rawConfig) {
    const configDefaultName = rawConfig.default_profile ?? 'default';
    const configDefault = rawConfig.profiles?.[configDefaultName];
    if (configDefault) {
      merged = deepMerge(merged, profileToFlat(configDefault));
    }
  }

  // ── Tier 3: Ingestion-source defaults from config file ──────────────
  if (rawConfig && sourceId) {
    const sourceDefaults = rawConfig.sources?.[sourceId];
    if (sourceDefaults) {
      merged = deepMerge(merged, profileToFlat(sourceDefaults));
    }
  }

  // ── Tier 2: Named profile from config file ──────────────────────────
  if (rawConfig && profileName) {
    const namedProfile = rawConfig.profiles?.[profileName];
    if (namedProfile) {
      merged = deepMerge(merged, profileToFlat(namedProfile));
    }
  }

  // ── Tier 1: CLI flag overrides ──────────────────────────────────────
  if (cliOverrides) {
    merged = deepMerge(merged, profileToFlat(cliOverrides));
  }

  // ── Construct ResolvedConfig ────────────────────────────────────────
  const m = merged as Record<string, unknown>;
  const llm = (m['llm'] ?? {}) as Record<string, unknown>;
  const editor = (m['editor'] ?? {}) as Record<string, unknown>;
  const extraction = (m['extraction'] ?? {}) as Record<string, unknown>;
  const exp = (m['export'] ?? {}) as Record<string, unknown>;
  const ytdlp = (m['ytdlp'] ?? {}) as Record<string, unknown>;
  const youtube = (m['youtube'] ?? {}) as Record<string, unknown>;
  const rss = (m['rss'] ?? {}) as Record<string, unknown>;
  const activeProfileName = profileName ?? rawConfig?.default_profile;

  // Build extensions with three scopes
  const extensions: ResolvedConfig['extensions'] = {};
  const topExt = rawConfig?.extensions;
  if (topExt && Object.keys(topExt).length > 0) {
    extensions.global = { ...topExt };
  }
  if (rawConfig && sourceId) {
    const srcExt = rawConfig.sources?.[sourceId]?.extensions;
    if (srcExt && Object.keys(srcExt).length > 0) {
      extensions.source = { ...srcExt };
    }
  }
  if (rawConfig && activeProfileName) {
    const profExt = rawConfig.profiles?.[activeProfileName]?.extensions;
    if (profExt && Object.keys(profExt).length > 0) {
      extensions.profile = { ...profExt };
    }
  }
  if (cliOverrides?.extensions && Object.keys(cliOverrides.extensions).length > 0) {
    extensions.profile = {
      ...(extensions.profile ?? {}),
      ...cliOverrides.extensions,
    };
  }

  return {
    baseDir,
    db: resolvePathValue((m['db'] as string) ?? '', baseDir),
    llm: {
      model: (llm['model'] as string) ?? '',
      apiKey: (llm['api_key'] as string) ?? '',
      baseUrl: (llm['base_url'] as string) ?? '',
      timeoutMs: (llm['timeout_ms'] as number) ?? 0,
      cacheDir: resolvePathValue((llm['cache_dir'] as string) ?? '', baseDir),
    },
    editor: {
      version: (editor['version'] as string) ?? '',
      windowMinutes: (editor['window_minutes'] as number) ?? 0,
      maxPerWindow: (editor['max_per_window'] as number) ?? 0,
      minWindows: (editor['min_windows'] as number) ?? 0,
      minWords: (editor['min_words'] as number) ?? 0,
      minChars: (editor['min_chars'] as number) ?? 0,
      editorLlm: (editor['editor_llm'] as boolean) ?? false,
    },
    extraction: {
      maxClaims: (extraction['max_claims'] as number) ?? 0,
      chunkMinutes: (extraction['chunk_minutes'] as number) ?? 0,
      maxChunks: (extraction['max_chunks'] as number) ?? 0,
      promptVersion: (extraction['prompt_version'] as string) ?? '',
    },
    export: {
      outDir: resolvePathValue((exp['out_dir'] as string) ?? '', baseDir),
      sourcePrefix: (exp['source_prefix'] as string) ?? '',
    },
    ytdlp: {
      bin: resolvePathValue((ytdlp['bin'] as string) ?? '', baseDir),
      cookiesFile: resolvePathValue((ytdlp['cookies_file'] as string) ?? '', baseDir),
      timeoutMs: (ytdlp['timeout_ms'] as number) ?? 0,
      jsRuntimes: (ytdlp['js_runtimes'] as string) ?? '',
      keepFiles: (ytdlp['keep_files'] as boolean) ?? false,
    },
    youtube: {
      cookie: (youtube['cookie'] as string) ?? '',
      innertubeApiKey: (youtube['innertube_api_key'] as string) ?? '',
      debugTranscript: (youtube['debug_transcript'] as boolean) ?? false,
    },
    // RSS config availability is source-dependent (Tier 3)
    // Currently used for future-proofing and testing extensibility.
    ...(rss['poll_interval_minutes'] !== undefined
      ? {
          rss: {
            pollIntervalMinutes: rss['poll_interval_minutes'] as number,
          },
        }
      : {}),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}
