/**
 * @aidha/config — Configuration provenance explanation.
 *
 * Tracks which tier each configuration value came from and
 * provides human-readable explanations for `aidha config explain`.
 *
 * @module
 */

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
      origin = 'profiles.default';
      break;
    case 'hardcoded':
      origin = 'built-in defaults (defaults.ts)';
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
