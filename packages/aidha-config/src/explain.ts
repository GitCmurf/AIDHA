/**
 * @aidha/config — Configuration provenance explanation.
 *
 * Tracks which tier each configuration value came from and
 * provides human-readable explanations for `aidha config explain`.
 *
 * @module
 */

import { DEFAULTS } from './defaults.js';
import { isSecretKey } from './redact.js';
import type { AidhaConfig, Profile, ResolvedConfig } from './types.js';

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
}

/** Options for building provenance. */
export interface ProvenanceOptions {
  profileName?: string;
  sourceId?: string;
}

export interface ResolveKeyProvenanceOptions {
  key: string;
  rawConfig?: AidhaConfig | null;
  resolvedConfig: ResolvedConfig;
  cliOverrides?: Partial<Profile>;
  profileName?: string;
  sourceId?: string;
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
        origin = `built-in source defaults (defaults.ts#sources.${options.sourceId})`;
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

/**
 * Resolve provenance for a single resolved config key.
 *
 * Centralizing this logic in @aidha/config prevents drift between CLI explain
 * behavior and resolver precedence as new sources/tiers evolve.
 */
export function resolveKeyProvenance(
  options: ResolveKeyProvenanceOptions,
): KeyProvenanceResult {
  const { key, rawConfig, resolvedConfig, cliOverrides, profileName, sourceId } = options;
  const altKey = toSnakeCasePath(key);
  const keyLeaf = key.split('.').at(-1) ?? key;
  const altKeyLeaf = altKey.split('.').at(-1) ?? altKey;
  const has = (obj: unknown): boolean => deepHas(obj, key) || deepHas(obj, altKey);

  const defaultProfileName = rawConfig?.default_profile ?? 'default';
  let tier: ConfigTier;
  let hardcodedFromSource = false;

  if (has(cliOverrides)) {
    tier = 'cli';
  } else if (profileName && has(rawConfig?.profiles?.[profileName])) {
    tier = 'profile';
  } else if (sourceId && has(rawConfig?.sources?.[sourceId])) {
    tier = 'source';
  } else if (has(rawConfig?.profiles?.[defaultProfileName])) {
    tier = 'default';
  } else if (has(DEFAULTS.profiles?.['default'])) {
    tier = 'hardcoded';
  } else if (sourceId && has(DEFAULTS.sources?.[sourceId])) {
    tier = 'hardcoded';
    hardcodedFromSource = true;
  } else {
    tier = 'hardcoded';
  }

  const provenanceProfileName =
    tier === 'profile'
      ? profileName
      : tier === 'default'
        ? defaultProfileName
      : tier === 'hardcoded' && !hardcodedFromSource
        ? defaultProfileName
      : undefined;
  const provenanceSourceId =
    tier === 'source' || (tier === 'hardcoded' && hardcodedFromSource)
      ? sourceId
      : undefined;

  const provenance = createProvenance(key, tier, {
    profileName: provenanceProfileName,
    sourceId: provenanceSourceId,
  }, isSecretKey(key) || isSecretKey(altKey) || isSecretKey(keyLeaf) || isSecretKey(altKeyLeaf));

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
export function formatProvenance(prov: Provenance, value: unknown): string {
  // Redact ALL secret values regardless of type — numbers, objects,
  // arrays, and even empty strings should never leak in explain output.
  let displayValue: string;
  if (prov.isSecret) {
    displayValue = '********';
  } else {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        displayValue = value === undefined ? 'undefined' : '[unserializable]';
      } else {
        displayValue = serialized;
      }
    } catch {
      displayValue = '[unserializable]';
    }
  }

  return `${prov.key} = ${displayValue}\n  ↳ ${prov.tierLabel} (from ${prov.origin})`;
}
