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
  UnresolvedAidhaConfig,
  Profile,
  ResolvedConfig,
  SourceRegistration,
  ConfigLogSink,
  DeepReadonly,
} from './types.js';
import { SUPPORTED_CONFIG_VERSION } from './types.js';
import { DEFAULTS } from './defaults.js';
import { resolvePathValue, resolvePathValues } from './paths.js';
import { validateConfig, validateRegisteredSourcePayload } from './schema.js';
import { ConfigValidationError } from './loader.js';
import { interpolateDeep } from './interpolation.js';


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
 * Interpolate only the core profile fields, leaving `source_overrides` untouched
 * until the matching source participates in resolution.
 */
function interpolateCoreProfile(profile: Profile | undefined, env: Record<string, string | undefined>): Record<string, unknown> {
  if (!profile) return {};
  return interpolateDeep(profileToCoreFlat(profile), env, { rootPath: 'profiles.*' }) as Record<string, unknown>;
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

/**
 * Collect source-private keys from a source payload-like object.
 */
function collectSourcePrivateKeys(payload: Record<string, unknown> | undefined): Set<string> {
  const keys = new Set<string>();
  if (!payload) return keys;

  for (const key of Object.keys(payload)) {
    if (!CORE_SECTION_NAMES.has(key) && key !== 'extensions') {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Extract source-private fields that were historically stored directly on a profile.
 *
 * These keys remain valid in the schema, so we keep routing them into
 * `activeSourceConfig` during the transition to `source_overrides`.
 */
function extractLegacyProfileSourceFields(
  profile: Profile | undefined,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (!profile) return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile as Record<string, unknown>)) {
    if (allowedKeys.has(key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
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
  rawConfig?: UnresolvedAidhaConfig | null;
  /** Hardcoded fallback defaults (Tier 5). Defaults to DEFAULTS. */
  defaults?: DeepReadonly<AidhaConfig>;
  /** The base directory for the resolved config. */
  baseDir?: string;
  /** Source registrations providing defaults, validation, and metadata. */
  sourceRegistrations?: SourceRegistration[];
  /** Environment map used for interpolation; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Callback for structured configuration events. */
  logSink?: ConfigLogSink;
  /** Telemetry: path to the config file (for logging). */
  configPath?: string | null;
  /** Telemetry: count of loaded environment variables from dotenv files. */
  dotenvVarCount?: number;
  /** Telemetry: count of warnings during load. */
  warningCount?: number;
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
    } else if (key !== 'extensions') {
      sourcePrivate[key] = value;
    }
  }
  return { core, sourcePrivate };
}

/**
 * Validate source-overrides core sections against the core config schema.
 *
 * Source-private payloads remain opaque, but core sections routed through
 * source_overrides must still satisfy the same type constraints as top-level
 * profile/source defaults before they are merged into ResolvedConfig.
 *
 * Throws `ConfigValidationError` so config bridges keep malformed
 * `source_overrides` on the user-config failure path.
 */
function partitionValidatedSourcePayload(
  payload: Record<string, unknown>,
  context: string,
): { core: Record<string, unknown>; sourcePrivate: Record<string, unknown> } {
  const partitioned = partitionSourcePayload(payload);
  if (Object.keys(partitioned.core).length === 0) {
    return partitioned;
  }

  const validation = validateConfig({
    config_version: SUPPORTED_CONFIG_VERSION,
    default_profile: 'default',
    profiles: {
      default: partitioned.core,
    },
  });

  if (!validation.valid) {
    const normalizedContext = context.replace(/\./g, '/').split('/').filter(Boolean).join('/');
    const errors = validation.errors.map((error) => {
      const normalizedIssuePath = error.path
        .split('/')
        .filter(Boolean)
        .join('/')
        .replace(/^profiles\/default\/?/, '');

      return {
        path: normalizedIssuePath
          ? `/${normalizedContext}/${normalizedIssuePath}`.replace(/\/+/g, '/')
          : `/${normalizedContext}`,
        message: error.message,
      };
    });

    throw new ConfigValidationError(context, errors);
  }

  return partitioned;
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
    defaults = DEFAULTS,
    baseDir = process.cwd(),
    sourceRegistrations = [],
    env: envOverride,
    logSink,
    configPath = null,
    dotenvVarCount = 0,
    warningCount = 0,
  } = options;

  const env = { ...process.env, ...(envOverride ?? {}) } as Record<string, string | undefined>;
  const activeProfileName = profileName ?? rawConfig?.default_profile ?? 'default';
  const registration = sourceId
    ? sourceRegistrations.find((r) => r.sourceId === sourceId)
    : undefined;
  const configDefaultName = rawConfig?.default_profile ?? 'default';

  // ── Tier 5: Hardcoded defaults ──────────────────────────────────────
  const defaultProfileRaw = defaults.profiles?.['default'];
  if (!defaultProfileRaw) {
    throw new Error('Fallback defaults object is missing required profiles.default');
  }
  // Interpolate only the core defaults; source-private data is handled later.
  let merged = interpolateCoreProfile(defaultProfileRaw as Profile, env);

  // Source registration defaults are the weakest source-specific layer.
  // Interpolated once here; the same result is reused for source payload below.
  const interpolatedRegistrationDefaults = sourceId && registration?.defaults
    ? interpolateDeep(registration.defaults, env, { rootPath: 'sources.*' })
    : undefined;

  if (interpolatedRegistrationDefaults) {
    const { core: registrationCore } = partitionSourcePayload(interpolatedRegistrationDefaults);
    if (Object.keys(registrationCore).length > 0) {
      merged = deepMerge(merged, registrationCore);
    }
  }

  // ── Tier 4: System-wide default profile from config file ────────────
  if (rawConfig) {
    const configDefaultRaw = rawConfig.profiles?.[configDefaultName];
    if (configDefaultRaw) {
      merged = deepMerge(merged, interpolateCoreProfile(configDefaultRaw as Profile, env));
    }
  }

  // ── Build activeSourceConfig from source layers ─────────────────────
  let activeSourceConfig: Record<string, unknown> | undefined;
  let defaultProfileSourceCore: Record<string, unknown> | undefined;
  let activeProfileSourceCore: Record<string, unknown> | undefined;
  let cliSourceCore: Record<string, unknown> | undefined;
  const legacySourceKeys = new Set<string>();

  const sourceDefaultsRaw = sourceId && rawConfig?.sources?.[sourceId]
    ? (rawConfig.sources[sourceId] as Record<string, unknown>)
    : undefined;
  const sourceDefaults = sourceDefaultsRaw
    ? interpolateDeep(sourceDefaultsRaw, env, { rootPath: 'sources.*' })
    : undefined;

  if (registration?.defaults) {
    // Collect keys from uninterpolated defaults for legacy mapping
    for (const key of collectSourcePrivateKeys(registration.defaults)) {
      legacySourceKeys.add(key);
    }
  }
  if (sourceDefaultsRaw) {
    for (const key of collectSourcePrivateKeys(sourceDefaultsRaw)) {
      legacySourceKeys.add(key);
    }
  }

  if (sourceId) {
    activeSourceConfig = {};

    // Layer 1: Registration defaults (weakest)
    if (interpolatedRegistrationDefaults) {
      const { sourcePrivate: registrationPrivate } = partitionSourcePayload(interpolatedRegistrationDefaults);
      activeSourceConfig = deepMerge(
        activeSourceConfig ?? {},
        registrationPrivate,
      );
    }

    // Layer 2: Default-profile source_overrides (weaker than source defaults)
    if (rawConfig?.profiles?.[configDefaultName]) {
      const configDefaultProfileRaw = rawConfig.profiles[configDefaultName];

      const defaultProfileLegacySourceFieldsRaw = extractLegacyProfileSourceFields(
        configDefaultProfileRaw,
        legacySourceKeys,
      );
      if (Object.keys(defaultProfileLegacySourceFieldsRaw).length > 0) {
        activeSourceConfig = deepMerge(
          activeSourceConfig ?? {},
          interpolateDeep(defaultProfileLegacySourceFieldsRaw, env, { rootPath: 'profiles.*' }),
        );
      }

      const defaultProfileSourceOverridesRaw = getSourceOverrides(configDefaultProfileRaw as Profile, sourceId);
      if (defaultProfileSourceOverridesRaw) {
        const {
          core: defaultProfileSourceCorePayload,
          sourcePrivate: defaultProfileSourcePrivate,
        } = partitionValidatedSourcePayload(
          interpolateDeep(defaultProfileSourceOverridesRaw, env, { rootPath: 'profiles.*.source_overrides.*' }),
          `profiles.${configDefaultName}.source_overrides.${sourceId}`,
        );
        activeSourceConfig = deepMerge(
          activeSourceConfig ?? {},
          defaultProfileSourcePrivate,
        );
        if (Object.keys(defaultProfileSourceCorePayload).length > 0) {
          defaultProfileSourceCore = deepMerge(
            defaultProfileSourceCore ?? {},
            defaultProfileSourceCorePayload,
          );
        }
      }
    }

    if (defaultProfileSourceCore) {
      merged = deepMerge(merged, defaultProfileSourceCore);
    }

    // Layer 3: sources.<sourceId> defaults (Tier 3)
    if (sourceDefaults) {
      // Also merge core-known sections from source defaults into core config
      const { core: sourceCore, sourcePrivate: sourcePrivateDefaults } =
        partitionValidatedSourcePayload(sourceDefaults, `sources.${sourceId}`);
      activeSourceConfig = deepMerge(
        activeSourceConfig ?? {},
        sourcePrivateDefaults,
      );
      if (Object.keys(sourceCore).length > 0) {
        merged = deepMerge(merged, sourceCore);
      }
    }

    // Layer 4: Active named profile source-private fields (Tier 2)
    // Explicitly selected profiles always get the active-profile source merge,
    // even when they match `default_profile`.
    if (rawConfig && profileName !== undefined) {
      const sourceProfileRaw = rawConfig.profiles?.[profileName] as Profile | undefined;

      const sourceProfileLegacySourceFieldsRaw = extractLegacyProfileSourceFields(
        sourceProfileRaw,
        legacySourceKeys,
      );      if (Object.keys(sourceProfileLegacySourceFieldsRaw).length > 0) {
        activeSourceConfig = deepMerge(
          activeSourceConfig ?? {},
          interpolateDeep(sourceProfileLegacySourceFieldsRaw, env, { rootPath: 'profiles.*' }),
        );
      }

      const sourceProfileOverridesRaw = sourceProfileRaw
        ? getSourceOverrides(sourceProfileRaw, sourceId)
        : undefined;
      if (sourceProfileOverridesRaw) {
        const {
          core: sourceProfileCore,
          sourcePrivate: sourceProfilePrivate,
        } = partitionValidatedSourcePayload(
          interpolateDeep(sourceProfileOverridesRaw, env, { rootPath: 'profiles.*.source_overrides.*' }),
          `profiles.${profileName}.source_overrides.${sourceId}`,
        );
        activeSourceConfig = deepMerge(
          activeSourceConfig ?? {},
          sourceProfilePrivate,
        );
        if (Object.keys(sourceProfileCore).length > 0) {
          activeProfileSourceCore = deepMerge(
            activeProfileSourceCore ?? {},
            sourceProfileCore,
          );
        }
      }
    }

    // Layer 5: CLI source overrides (strongest for source payload)
    if (cliOverrides?.source_overrides?.[sourceId]) {
      const cliSourceOverridesRaw = cliOverrides.source_overrides[sourceId] as Record<string, unknown>;
      const cliSourceOverrides = interpolateDeep(cliSourceOverridesRaw, env, { rootPath: 'source_overrides.*' });

      const {
        core: cliCore,
        sourcePrivate: cliSourcePrivate,
      } = partitionValidatedSourcePayload(
        cliSourceOverrides,
        `cliOverrides.source_overrides.${sourceId}`,
      );
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
    const namedProfileRaw = rawConfig.profiles?.[profileName];
    if (namedProfileRaw) {
      merged = deepMerge(merged, interpolateCoreProfile(namedProfileRaw as Profile, env));
    }
  }

  if (activeProfileSourceCore) {
    merged = deepMerge(merged, activeProfileSourceCore);
  }

  // ── Tier 1: CLI flag overrides ──────────────────────────────────────
  if (cliOverrides) {
    merged = deepMerge(merged, interpolateCoreProfile(cliOverrides as Profile, env));
  }

  if (cliSourceCore) {
    merged = deepMerge(merged, cliSourceCore);
  }

  // ── Final validation ────────────────────────────────────────────────
  if (sourceId && activeSourceConfig) {
    const sourceErrors = validateRegisteredSourcePayload(
      sourceId,
      activeSourceConfig,
      `activeSourceConfig.${sourceId}`,
      sourceRegistrations,
    );
    if (sourceErrors.length > 0) {
      throw new ConfigValidationError(configPath ?? 'resolved-config', sourceErrors);
    }
  }

  const finalFullConfig: AidhaConfig = {
    config_version: SUPPORTED_CONFIG_VERSION,
    default_profile: activeProfileName,
    profiles: {
      [activeProfileName]: merged,
    },
  };

  const validation = validateConfig(finalFullConfig, sourceRegistrations);
  if (!validation.valid) {
    throw new ConfigValidationError(configPath ?? 'resolved-config', validation.errors);
  }

  const resolvedActiveSourceConfig = activeSourceConfig;

  // ── Emit summary event ──────────────────────────────────────────────
  if (logSink) {
    const cliOverrideKeys: string[] = [];
    if (cliOverrides) {
      for (const key of Object.keys(cliOverrides)) {
        if (key === 'source_overrides' && cliOverrides.source_overrides && sourceId) {
          const srcKeys = Object.keys(cliOverrides.source_overrides[sourceId] ?? {});
          cliOverrideKeys.push(...srcKeys.map((k) => `source_overrides.${sourceId}.${k}`));
        } else {
          cliOverrideKeys.push(key);
        }
      }
    }

    logSink({
      type: 'config.load.summary',
      configPath,
      profile: activeProfileName,
      sourceId,
      dotenvVarCount,
      warningCount,
      cliOverrideKeys,
    });
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
    const profExt = (rawConfig.profiles?.[activeProfileName] as Profile | undefined)?.extensions;
    if (profExt && Object.keys(profExt).length > 0) {
      extensions.profile = { ...profExt };
    }
  }  if (cliOverrides?.extensions && Object.keys(cliOverrides.extensions).length > 0) {
    extensions.profile = {
      ...(extensions.profile ?? {}),
      ...cliOverrides.extensions,
    };
  }

  const resolved: ResolvedConfig = {
    baseDir,
    db: (m['db'] as string) ?? '',
    llm: {
      model: (llm['model'] as string) ?? '',
      apiKey: (llm['api_key'] as string) ?? '',
      baseUrl: (llm['base_url'] as string) ?? '',
      timeoutMs: (llm['timeout_ms'] as number) ?? 0,
      cacheDir: (llm['cache_dir'] as string) ?? '',
      reasoningEffort: (['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const).find(
        (value) => value === llm['reasoning_effort'],
      ),
      verbosity: (['low', 'medium', 'high'] as const).find((value) => value === llm['verbosity']),
      embeddingBatchSize: (llm['embedding_batch_size'] as number) ?? 20,
      embeddingTaskType:
        (['RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT', 'SEMANTIC_SIMILARITY', 'CLASSIFICATION', 'CLUSTERING'] as const).find(
          (value) => value === llm['embedding_task_type'],
        ) ?? 'SEMANTIC_SIMILARITY',
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
      outDir: (exp['out_dir'] as string) ?? '',
      sourcePrefix: (exp['source_prefix'] as string) ?? '',
    },
    ...(sourceId ? { activeSourceId: sourceId } : {}),
    ...(resolvedActiveSourceConfig !== undefined ? { activeSourceConfig: resolvedActiveSourceConfig } : {}),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };

  // ── Final path resolution ───────────────────────────────────────────
  return resolvePathValues(resolved as unknown as Record<string, unknown>, baseDir) as unknown as ResolvedConfig;
}
