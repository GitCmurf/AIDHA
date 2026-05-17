// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Secret redaction utilities.
 *
 * Masks sensitive values in a `ResolvedConfig` for safe display
 * in CLI output, logs, and `aidha config show`.
 *
 * Detection strategy:
 *   1. Schema-aware: keys annotated with `x-aidha-secret: true`.
 *   2. Heuristic fallback: key names containing common secret patterns.
 *
 * @module
 */

import { SECRET_LEAF_NAMES } from './schema.generated.js';
import { validateLength, ValidationError } from './validation.js';
import type { SourceRegistration } from './types.js';

const SECRET_LEAF_NAMES_SET = new Set(SECRET_LEAF_NAMES);

const REDACTED = '********';

/** Maximum key length to prevent potential ReDoS attacks. */
const MAX_KEY_LENGTH = 256;

/** Heuristic patterns for secret key names (case-insensitive). */
const SECRET_PATTERNS = [
  'secret',
  'token',
  'access_token',
  'accesstoken',
  'auth_token',
  'authtoken',
  'api_key',
  'apikey',
  'password',
  'cookie',
  'credential',
  'private_key',
  'privatekey',
];

/**
 * Check if a key name matches a heuristic secret pattern.
 */
function isHeuristicSecret(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Check if a key should be treated as a secret.
 *
 * Consumes SECRET_LEAF_NAMES from schema.generated.ts for schema-aware redaction.
 *
 * @param key - The property name (leaf name, e.g., "apiKey" or "api_key").
 * @param extraSecretNames - Optional additional secret names (for testing).
 * @returns `true` if the key is annotated or matches a heuristic pattern.
 */
export function isSecretKey(key: string, extraSecretNames?: Set<string>): boolean {
  const snakeCase = toSnakeCase(key);
  if (extraSecretNames) {
    const merged = new Set(SECRET_LEAF_NAMES_SET);
    for (const name of extraSecretNames) merged.add(name);
    return merged.has(key) || merged.has(snakeCase) || isHeuristicSecret(key);
  }
  return SECRET_LEAF_NAMES_SET.has(key) || SECRET_LEAF_NAMES_SET.has(snakeCase) || isHeuristicSecret(key);
}



function shouldRedactKey(key: string): boolean {
  try {
    return isSecretKey(key);
  } catch (error) {
    if (error instanceof ValidationError && error.code === 'LENGTH_EXCEEDED') {
      return true;
    }

    throw error;
  }
}

function toSnakeCase(key: string): string {
  validateLength(key, MAX_KEY_LENGTH, 'Key');
  const output: string[] = [];

  for (let index = 0; index < key.length; index += 1) {
    const char = key[index] ?? '';
    if (char === '-') {
      output.push('_');
      continue;
    }

    const previous = key[index - 1];
    const next = key[index + 1];
    const isUpper = char >= 'A' && char <= 'Z';
    const previousIsLowerOrDigit = previous !== undefined && (
      (previous >= 'a' && previous <= 'z') || (previous >= '0' && previous <= '9')
    );
    const previousIsUpper = previous !== undefined && previous >= 'A' && previous <= 'Z';
    const nextIsLowerOrDigit = next !== undefined && (
      (next >= 'a' && next <= 'z') || (next >= '0' && next <= '9')
    );

    if (
      isUpper &&
      output.length > 0 &&
      output[output.length - 1] !== '_' &&
      (previousIsLowerOrDigit || (previousIsUpper && nextIsLowerOrDigit))
    ) {
      output.push('_');
    }
    output.push(char.toLowerCase());
  }

  while (output[0] === '_') {
    output.shift();
  }
  return output.join('');
}

/**
 * Create a deep copy of an object with secret values redacted.
 *
 * All values on secret keys are replaced with `'********'`.
 *
 * @param obj - The object to redact (not mutated).
 * @returns A new object with secrets masked.
 */
export function redactSecrets<T>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item)) as unknown as T;
  }

  // Config should be JSON-like; preserve non-plain object instances (Date, Map, etc.)
  // rather than turning them into `{}` via Object.entries.
  if (!isPlainObject(obj)) return obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (shouldRedactKey(key)) {
      result[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The redaction placeholder string. Exported for test assertions. */
export { REDACTED };

export function redactWithRegistrations<T>(
  obj: T,
  registrations: ReadonlyArray<SourceRegistration>,
): T {
  const coreRedacted = redactSecrets(obj);
  if (typeof coreRedacted !== 'object' || coreRedacted === null) return coreRedacted;

  const record = coreRedacted as Record<string, unknown>;
  if (record['activeSourceConfig'] !== undefined && record['activeSourceConfig'] !== null) {
    const sourceId = record['activeSourceId'] as string | undefined;
    if (sourceId) {
      const registration = registrations.find((r) => r.sourceId === sourceId);
      if (registration?.redactActiveSourceConfig) {
        record['activeSourceConfig'] = registration.redactActiveSourceConfig(record['activeSourceConfig']);
      }
    }
  }

  return coreRedacted;
}
