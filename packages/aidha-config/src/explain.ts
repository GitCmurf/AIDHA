// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Configuration provenance explanation.
 *
 * Tracks which tier each configuration value came from and
 * provides human-readable explanations for `aidha config explain`.
 *
 * @module
 */

import { DEFAULTS } from './defaults.js';
import { isSecretKey, redactSecrets } from './redact.js';
import type { AidhaConfig, Profile, ResolvedConfig, SourceRegistration } from './types.js';

/** The five configuration tiers, from highest to lowest priority. */
export type ConfigTier =
  | 'cli'           // Tier 1: CLI flags
  | 'profile'       // Tier 2: Named profile
  | 'source'        // Tier 3: Source defaults
  | 'default'       // Tier 4: System-wide default profile
  | 'hardcoded';    // Tier 5: Hardcoded fallback

/** Human-readable tier labels. */
const TIER_LABELS: Record<ConfigTier, string> = {
  cli: 'CLI flag (Tier 1)',
  profile: 'Named profile (Tier 2)',
  source: 'Source defaults (Tier 3)',
  default: 'Default profile (Tier 4)',
  hardcoded: 'Hardcoded default (Tier 5)',
};

/** Provenance record for a single config key. */
export interface Provenance {
  /** The config key path (dot-notation, e.g., "llm.model"). */
  key: string;
  /** The tier that provided the winning value. */
  tier: ConfigTier;
  /** Human-readable description of the tier. */
  tierLabel: string;
  /** The origin of the value (e.g., profile name, source ID, "CLI --model"). */
  origin: string;
  /** Whether the value is a secret (should be redacted in output). */
  isSecret: boolean;
  /** Validation status of the key. */
  validationStatus: 'core' | 'source' | 'unvalidated';
}

/** Options for building provenance. */
export interface ProvenanceOptions {
  profileName?: string;
  sourceId?: string;
  validationStatus?: 'core' | 'source' | 'unvalidated';
}

export interface ResolveKeyProvenanceOptions {
  key: string;
  rawConfig?: AidhaConfig | null;
  resolvedConfig: ResolvedConfig;
  cliOverrides?: Partial<Profile>;
  profileName?: string;
  sourceId?: string;
  sourceRegistrations?: ReadonlyArray<SourceRegistration>;
}

export interface KeyProvenanceResult {
  value: unknown;
  provenance: Provenance;
}

/**
 * Create a provenance record for a configuration key.
 */
export function createProvenance(
  key: string,
  tier: ConfigTier,
  options: ProvenanceOptions = {},
  isSecret = false,
): Provenance {
  let origin: string;

  switch (tier) {
    case 'cli':
      origin = `CLI flag --${key.replace(/\./g, '-').replace(/_/g, '-')}`;
      break;
    case 'profile':
      origin = options.profileName
        ? `profiles.${options.profileName}`
        : 'named profile';
      break;
    case 'source':
      origin = options.sourceId
        ? `sources.${options.sourceId}`
        : 'source defaults';
      break;
    case 'default':
      origin = options.profileName
        ? `profiles.${options.profileName}`
        : 'profiles.default';
      break;
    case 'hardcoded':
      if (options.sourceId) {
        origin = `built-in source defaults (source registration: ${options.sourceId})`;
      } else if (options.profileName) {
        origin = `built-in defaults (defaults.ts#profiles.${options.profileName})`;
      } else {
        origin = 'built-in defaults (defaults.ts)';
      }
      break;
  }

  return {
    key,
    tier,
    tierLabel: TIER_LABELS[tier],
    origin,
    isSecret,
    validationStatus: options.validationStatus ?? 'unvalidated',
  };
}

function deepGet(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function deepHas(obj: unknown, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return false;
    }
    const record = current as Record<string, unknown>;
    if (!(part in record)) {
      return false;
    }
    current = record[part];
  }
  return true;
}

function toSnakeCasePath(path: string): string {
  return path
    .split('.')
    .map(segment => segment.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`))
    .join('.');
}

function toKeyCandidates(path: string): string[] {
  const snakeCasePath = toSnakeCasePath(path);
  return snakeCasePath === path ? [path] : [path, snakeCasePath];
}

function hasAnyPath(obj: unknown, paths: ReadonlyArray<string>): boolean {
  return paths.some(path => deepHas(obj, path));
}

function sourceOverridePaths(sourceId: string, paths: ReadonlyArray<string>): string[] {
  return paths.map(path => `source_overrides.${sourceId}.${path}`);
}

function profileSourceOverridesHasKey(
  profile: Profile | undefined,
  sourceId: string,
  paths: ReadonlyArray<string>,
): boolean {
  return hasAnyPath(profile?.source_overrides?.[sourceId], paths);
}

function registrationDefaultsHasKey(
  sourceId: string,
  paths: ReadonlyArray<string>,
  sourceRegistrations?: ReadonlyArray<SourceRegistration>,
): boolean {
  return sourceRegistrations?.some(registration =>
    registration.sourceId === sourceId &&
    hasAnyPath(registration.defaults, paths),
  ) ?? false;
}

function isCoreValidated(key: string): boolean {
  // Simple check for core sections
  const coreSections = ['llm', 'editor', 'extraction', 'export', 'db', 'base_dir', 'env', 'default_profile', 'config_version'];
  const firstPart = key.split('.')[0];
  return coreSections.includes(firstPart!);
}

function isSourceValidated(key: string, sourceId?: string, registrations?: ReadonlyArray<SourceRegistration>): boolean {
  if (!sourceId || !registrations) return false;
  const sourceKey = key.startsWith('activeSourceConfig.')
    ? key.slice('activeSourceConfig.'.length)
    : key;

  const registration = registrations.find(r => r.sourceId === sourceId);
  if (!registration) return false;

  // If it has scalar coercion or explicit label, it's considered validated/known by source
  if (registration.metadata?.scalarCoercions?.[sourceKey]) return true;
  if (registration.metadata?.explainLabels?.[sourceKey]) return true;
  if (registration.metadata?.pathFields?.includes(sourceKey)) return true;
  if (registration.metadata?.secretFields?.includes(sourceKey)) return true;

  return false;
}

/**
 * Resolve provenance for a single resolved config key.
 *
 * Centralizing this logic in @aidha/config prevents drift between CLI explain
 * behavior and resolver precedence as new sources/tiers evolve.
 */
export function resolveKeyProvenance(
  options: ResolveKeyProvenanceOptions,
): KeyProvenanceResult {
  const {
    key,
    rawConfig,
    resolvedConfig,
    cliOverrides,
    profileName,
    sourceId,
    sourceRegistrations,
  } = options;
  const sourceKey = key.startsWith('activeSourceConfig.')
    ? key.slice('activeSourceConfig.'.length)
    : key;
  const keyCandidates = toKeyCandidates(sourceKey);
  const sourceSpecificCandidates = sourceId
    ? sourceOverridePaths(sourceId, keyCandidates)
    : [];
  const keyLeaf = key.split('.').at(-1) ?? key;
  const sourceKeyLeaf = sourceKey.split('.').at(-1) ?? sourceKey;
  const has = (obj: unknown): boolean => hasAnyPath(obj, keyCandidates) || hasAnyPath(obj, sourceSpecificCandidates);

  const defaultProfileName = rawConfig?.default_profile ?? 'default';
  const activeProfileName = profileName ?? defaultProfileName;
  const activeProfile = rawConfig?.profiles?.[activeProfileName];
  let tier: ConfigTier;
  let hardcodedFromSource = false;

  if (has(cliOverrides)) {
    tier = 'cli';
  } else if (profileName && has(rawConfig?.profiles?.[profileName])) {
    tier = 'profile';
  } else if (sourceId && has(rawConfig?.sources?.[sourceId])) {
    tier = 'source';
  } else if (has(activeProfile)) {
    tier = 'default';
  } else if (has(rawConfig?.profiles?.[defaultProfileName])) {
    tier = 'default';
  } else if (sourceId && registrationDefaultsHasKey(sourceId, keyCandidates, sourceRegistrations)) {
    tier = 'hardcoded';
    hardcodedFromSource = true;
  } else if (has(DEFAULTS.profiles?.['default'])) {
    tier = 'hardcoded';
  } else {
    tier = 'hardcoded';
  }

  const provenanceProfileName =
    tier === 'profile'
      ? (profileName ?? activeProfileName)
      : tier === 'default'
        ? defaultProfileName
      : tier === 'hardcoded' && !hardcodedFromSource
        ? 'default'
        : undefined;
  const provenanceSourceId =
    tier === 'source' || (tier === 'hardcoded' && hardcodedFromSource)
      ? sourceId
      : undefined;

  let validationStatus: 'core' | 'source' | 'unvalidated' = 'unvalidated';
  if (isCoreValidated(sourceKey)) {
    validationStatus = 'core';
  } else if (isSourceValidated(sourceKey, sourceId, sourceRegistrations)) {
    validationStatus = 'source';
  }

  const provenance = createProvenance(key, tier, {
    profileName: provenanceProfileName,
    sourceId: provenanceSourceId,
    validationStatus,
  }, isSecretKey(key) || isSecretKey(sourceKey) || isSecretKey(keyLeaf) || isSecretKey(sourceKeyLeaf));

  const value = deepGet(resolvedConfig, key);
  return { value, provenance };
}

/**
 * Format a provenance record as a human-readable string for CLI output.
 *
 * @param prov - The provenance record.
 * @param value - The actual value (will be redacted if secret).
 * @returns A formatted explanation string.
 */
export function formatProvenance(
  prov: Provenance,
  value: unknown,
  sourceRegistrations?: ReadonlyArray<SourceRegistration>,
): string {
  let displayValue: string;
  if (prov.isSecret) {
    displayValue = '********';
  } else {
    try {
      const safeValue = (typeof value === 'object' && value !== null)
        ? redactSecrets(value)
        : value;
      const serialized = JSON.stringify(safeValue);
      if (serialized === undefined) {
        displayValue = value === undefined ? 'undefined' : '[unserializable]';
      } else {
        displayValue = serialized;
      }
    } catch {
      displayValue = '[unserializable]';
    }
  }

  const sourceLabel = resolveSourceLabel(prov.key, sourceRegistrations);
  const labelSuffix = sourceLabel ? ` — ${sourceLabel}` : '';
  const validationLabel = prov.validationStatus === 'core'
    ? ' [core validated]'
    : prov.validationStatus === 'source'
      ? ' [source validated]'
      : ' [unvalidated]';

  return `${prov.key} = ${displayValue}${validationLabel}\n  ↳ ${prov.tierLabel} (from ${prov.origin})${labelSuffix}`;
}

function resolveSourceLabel(
  key: string,
  registrations?: ReadonlyArray<SourceRegistration>,
): string | null {
  if (!registrations) return null;
  const sourceKey = key.startsWith('activeSourceConfig.')
    ? key.slice('activeSourceConfig.'.length)
    : key;
  for (const reg of registrations) {
    const label = reg.metadata?.explainLabels?.[sourceKey];
    if (label) return label;
  }
  return null;
}
