// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Five-tier configuration resolver.
 *
 * Merges configuration from five tiers (CLI → profile → source → default → hardcoded)
 * into a core `ResolvedConfig` plus an opaque `activeSourceConfig` for source-private
 * fields.
 *
 * Merge semantics:
 *   - Scalars: higher tier wins.
 *   - Objects: deep-merge (recursive).
 *   - Arrays: higher tier replaces entirely (no concatenation).
 *
 * Source-private fields are collected into `activeSourceConfig` and validated
 * by the owning source package via `SourceRegistration`. The core resolver
 * does not interpret source-private payloads.
 *
 * @module
 */

import type {
  AidhaConfig,
  Profile,
  ResolvedConfig,
  SourceRegistration,
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
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }

  return result as T;
}

// ── Core profile fields ──────────────────────────────────────────────────────

const CORE_PROFILE_KEYS = new Set([
  'db', 'llm', 'editor', 'extraction', 'export',
  'source_overrides', 'extensions',
]);

/**
 * Extract only core-known fields from a profile-like object.
 * Source-private keys are excluded so they flow into activeSourceConfig.
 */
function extractCoreFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (CORE_PROFILE_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert a `Profile` into a flat record of core fields for merging.
 */
function profileToCoreFlat(profile: Profile): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (profile.db !== undefined) flat['db'] = profile.db;
  if (profile.llm) flat['llm'] = { ...profile.llm };
  if (profile.editor) flat['editor'] = { ...profile.editor };
  if (profile.extraction) flat['extraction'] = { ...profile.extraction };
  if (profile.export) flat['export'] = { ...profile.export };
  return flat;
}

/**
 * Extract source_overrides for a specific source ID from a profile.
 * Returns ALL keys (core + source-private) because source_overrides
 * is the explicit channel for source-private profile overrides.
 */
function getSourceOverrides(
  profile: Profile | undefined,
  sourceId: string,
): Record<string, unknown> | undefined {
  if (!profile?.source_overrides) return undefined;
  const overrides = profile.source_overrides[sourceId];
  return overrides && typeof overrides === 'object' ? overrides as Record<string, unknown> : undefined;
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
  /** Source registrations providing defaults, validation, and metadata. */
  sourceRegistrations?: SourceRegistration[];
}

/** Core-known section names that may appear in source defaults. */
const CORE_SECTION_NAMES = new Set(['llm', 'editor', 'extraction', 'export', 'db']);

/**
 * Separate a source payload into core-known sections and source-private sections.
 */
function partitionSourcePayload(
  payload: Record<string, unknown>,
): { core: Record<string, unknown>; sourcePrivate: Record<string, unknown> } {
  const core: Record<string, unknown> = {};
  const sourcePrivate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (CORE_SECTION_NAMES.has(key)) {
      core[key] = value;
    } else {
      sourcePrivate[key] = value;
    }
  }
  return { core, sourcePrivate };
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
 * Source-private fields are collected into `activeSourceConfig`.
 * Core-known fields from source layers merge into the core `ResolvedConfig`.
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
    sourceRegistrations = [],
  } = options;

  const activeProfileName = profileName ?? rawConfig?.default_profile ?? 'default';
  const registration = sourceId
    ? sourceRegistrations.find(r => r.sourceId === sourceId)
    : undefined;

  // ── Tier 5: Hardcoded defaults ──────────────────────────────────────
  const defaultProfile = DEFAULTS.profiles?.['default'];
  if (!defaultProfile) {
    throw new Error('Hardcoded DEFAULTS is missing required profiles.default');
  }
  let merged = profileToCoreFlat(defaultProfile as Profile);

  // ── Tier 4: System-wide default profile from config file ────────────
  if (rawConfig) {
    const configDefaultName = rawConfig.default_profile ?? 'default';
    const configDefault = rawConfig.profiles?.[configDefaultName];
    if (configDefault) {
      merged = deepMerge(merged, profileToCoreFlat(configDefault));
    }
  }

  // ── Build activeSourceConfig from source layers ─────────────────────
  let activeSourceConfig: Record<string, unknown> | undefined;
  let namedProfileSourceCore: Record<string, unknown> | undefined;
  let cliSourceCore: Record<string, unknown> | undefined;

  if (sourceId) {
    activeSourceConfig = {};

    // Layer 1: Registration defaults (weakest)
    if (registration?.defaults) {
      activeSourceConfig = deepMerge(
        activeSourceConfig ?? {},
        registration.defaults as Record<string, unknown>,
      );
    }

    // Layer 2: Default profile source_overrides
    if (rawConfig) {
      const configDefaultName = rawConfig.default_profile ?? 'default';
      const defaultProfileOverrides = getSourceOverrides(
        rawConfig.profiles?.[configDefaultName],
        sourceId,
      );
      if (defaultProfileOverrides) {
        const { core: defaultProfileCore, sourcePrivate: defaultProfilePrivate } =
          partitionSourcePayload(defaultProfileOverrides);
        activeSourceConfig = deepMerge(
          activeSourceConfig ?? {},
          defaultProfilePrivate,
        );
        if (Object.keys(defaultProfileCore).length > 0) {
          merged = deepMerge(merged, defaultProfileCore);
        }
      }
    }

    // Layer 3: sources.<sourceId> defaults (Tier 3)
    if (rawConfig?.sources?.[sourceId]) {
      const sourceDefaults = rawConfig.sources[sourceId] as Record<string, unknown>;
      activeSourceConfig = deepMerge(
        activeSourceConfig ?? {},
        sourceDefaults,
      );

      // Also merge core-known sections from source defaults into core config
      const { core: sourceCore } = partitionSourcePayload(sourceDefaults);
      if (Object.keys(sourceCore).length > 0) {
        merged = deepMerge(merged, sourceCore);
      }
    }

    // Layer 4: Named profile source_overrides
    if (rawConfig && profileName) {
      const namedProfileOverrides = getSourceOverrides(
        rawConfig.profiles?.[profileName],
        sourceId,
      );
      if (namedProfileOverrides) {
        const { core: namedProfileCore, sourcePrivate: namedProfilePrivate } =
          partitionSourcePayload(namedProfileOverrides);
        activeSourceConfig = deepMerge(
          activeSourceConfig ?? {},
          namedProfilePrivate,
        );
        if (Object.keys(namedProfileCore).length > 0) {
          namedProfileSourceCore = deepMerge(
            namedProfileSourceCore ?? {},
            namedProfileCore,
          );
        }
      }
    }

    // Layer 5: CLI source overrides (strongest for source payload)
    if (cliOverrides?.source_overrides?.[sourceId]) {
      const cliSourceOverrides = cliOverrides.source_overrides[sourceId] as Record<string, unknown>;
      const { core: cliCore, sourcePrivate: cliSourcePrivate } =
        partitionSourcePayload(cliSourceOverrides);
      activeSourceConfig = deepMerge(
        activeSourceConfig ?? {},
        cliSourcePrivate,
      );
      if (Object.keys(cliCore).length > 0) {
        cliSourceCore = deepMerge(cliSourceCore ?? {}, cliCore);
      }
    }
  }

  // ── Tier 2: Named profile from config file ──────────────────────────
  if (rawConfig && profileName) {
    const namedProfile = rawConfig.profiles?.[profileName];
    if (namedProfile) {
      merged = deepMerge(merged, profileToCoreFlat(namedProfile));
    }
  }

  if (namedProfileSourceCore) {
    merged = deepMerge(merged, namedProfileSourceCore);
  }

  // ── Tier 1: CLI flag overrides ──────────────────────────────────────
  if (cliOverrides) {
    merged = deepMerge(merged, profileToCoreFlat(cliOverrides));
  }

  if (cliSourceCore) {
    merged = deepMerge(merged, cliSourceCore);
  }

  // ── Construct ResolvedConfig ────────────────────────────────────────
  const m = merged as Record<string, unknown>;
  const llm = (m['llm'] ?? {}) as Record<string, unknown>;
  const editor = (m['editor'] ?? {}) as Record<string, unknown>;
  const extraction = (m['extraction'] ?? {}) as Record<string, unknown>;
  const exp = (m['export'] ?? {}) as Record<string, unknown>;

  // Build extensions with three scopes
  const extensions: ResolvedConfig['extensions'] = {};
  const topExt = rawConfig?.extensions;
  if (topExt && Object.keys(topExt).length > 0) {
    extensions.global = { ...topExt };
  }
  if (rawConfig && sourceId) {
    const srcExt = (rawConfig.sources?.[sourceId] as Record<string, unknown> | undefined)?.['extensions'];
    if (srcExt && typeof srcExt === 'object' && Object.keys(srcExt as Record<string, unknown>).length > 0) {
      extensions.source = { ...(srcExt as Record<string, unknown>) };
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
      reasoningEffort: (['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const).find(
        value => value === llm['reasoning_effort']
      ),
      verbosity: (['low', 'medium', 'high'] as const).find(
        value => value === llm['verbosity']
      ),
      embeddingBatchSize: (llm['embedding_batch_size'] as number) ?? 20,
      embeddingTaskType: (
        ['RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT', 'SEMANTIC_SIMILARITY', 'CLASSIFICATION', 'CLUSTERING'] as const
      ).find(value => value === llm['embedding_task_type']) ?? 'SEMANTIC_SIMILARITY',
      embeddingOutputDimensionality: (llm['embedding_output_dimensionality'] as number) ?? 768,
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
    ...(sourceId ? { activeSourceId: sourceId } : {}),
    ...(activeSourceConfig !== undefined ? { activeSourceConfig } : {}),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}
