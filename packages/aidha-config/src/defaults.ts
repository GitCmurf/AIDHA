// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Tier 5 hardcoded fallback defaults.
 *
 * These values represent the "no config file" baseline. Every core key that
 * appears in `ResolvedConfig` must have a corresponding hardcoded default
 * here so the system works out of the box (zero-config).
 *
 * Source-specific defaults are NOT stored here. Source packages own their
 * built-in defaults and supply them through `SourceRegistration.defaults`.
 *
 * @module
 */

import type { AidhaConfig, DeepReadonly } from './types.js';
import { SUPPORTED_CONFIG_VERSION } from './types.js';

/**
 * Complete hardcoded defaults (Tier 5).
 *
 * The `profiles.default` section contains the system-wide defaults.
 * Source defaults live in source-package registrations.
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
        embedding_batch_size: 20,
        embedding_task_type: 'SEMANTIC_SIMILARITY',
        embedding_output_dimensionality: 768,
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
} as const;
