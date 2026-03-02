// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Tier 5 hardcoded fallback defaults.
 *
 * These values represent the "no config file" baseline. Every key that
 * appears in `ResolvedConfig` must have a corresponding hardcoded default
 * here so the system works out of the box (zero-config).
 *
 * @module
 */

import type { AidhaConfig, DeepReadonly, SourceDefaults } from './types.js';
import { SUPPORTED_CONFIG_VERSION } from './types.js';

/** Built-in source defaults for the YouTube ingestion vector. */
const YOUTUBE_SOURCE_DEFAULTS: DeepReadonly<SourceDefaults> = {
  ytdlp: {
    bin: 'yt-dlp',
    cookies_file: '',
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
} as const;

/**
 * Complete hardcoded defaults (Tier 5).
 *
 * The `profiles.default` section contains the system-wide defaults.
 * The `sources` section contains per-source defaults.
 *
 * This object MUST validate against `config.schema.json`.
 */
export const DEFAULTS: DeepReadonly<AidhaConfig> = {
  config_version: SUPPORTED_CONFIG_VERSION,
  default_profile: 'default',
  profiles: {
    default: {
      db: './out/aidha.sqlite',
      llm: {
        model: 'gpt-5-mini',
        api_key: '',
        base_url: 'https://api.openai.com/v1',
        timeout_ms: 30_000,
        cache_dir: './out/cache/claims',
        reasoning_effort: 'medium',
        verbosity: 'medium',
      },
      editor: {
        version: 'v2',
        window_minutes: 5,
        max_per_window: 3,
        min_windows: 4,
        min_words: 8,
        min_chars: 50,
        editor_llm: false,
      },
      extraction: {
        max_claims: 15,
        chunk_minutes: 5,
        max_chunks: 0,
        prompt_version: 'v1',
      },
      export: {
        source_prefix: 'youtube',
        out_dir: './out',
      },
    },
  },
  sources: {
    youtube: YOUTUBE_SOURCE_DEFAULTS,
    rss: {
      rss: {
        poll_interval_minutes: 60,
      },
    },
  },
} as const;
