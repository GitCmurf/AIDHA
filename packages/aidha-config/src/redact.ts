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

import { loadSchema } from './schema.js';

const REDACTED = '********';

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

// ── Schema-driven secret key discovery ───────────────────────────────────────

let _secretLeafNames: Set<string> | undefined;

/**
 * Extract leaf property names annotated with `x-aidha-secret: true`
 * from the JSON Schema.
 */
function getSecretLeafNames(): Set<string> {
  if (_secretLeafNames) return _secretLeafNames;

  const schema = loadSchema();
  const names = new Set<string>();
  const visited = new WeakSet<object>();

  function walk(obj: unknown): void {
    if (obj === null || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;
    if (visited.has(record as object)) return;
    visited.add(record as object);

    if (typeof record['properties'] === 'object' && record['properties'] !== null) {
      for (const [key, val] of Object.entries(
        record['properties'] as Record<string, unknown>,
      )) {
        if (
          val !== null &&
          typeof val === 'object' &&
          (val as Record<string, unknown>)['x-aidha-secret'] === true
        ) {
          names.add(key);
        }
        walk(val);
      }
    }

    if (typeof record['$defs'] === 'object' && record['$defs'] !== null) {
      for (const [, val] of Object.entries(
        record['$defs'] as Record<string, unknown>,
      )) {
        walk(val);
      }
    }

    // Traverse additional schema constructs where secret fields may live.
    const additionalProps = record['additionalProperties'];
    if (additionalProps !== null && typeof additionalProps === 'object') {
      walk(additionalProps);
    }

    const items = record['items'];
    if (items !== null && typeof items === 'object') {
      walk(items);
    }

    const patternProps = record['patternProperties'];
    if (patternProps !== null && typeof patternProps === 'object') {
      for (const [, val] of Object.entries(patternProps as Record<string, unknown>)) {
        walk(val);
      }
    }

    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const arr = record[keyword];
      if (Array.isArray(arr)) {
        for (const item of arr) walk(item);
      }
    }

    for (const keyword of ['if', 'then', 'else'] as const) {
      const branch = record[keyword];
      if (branch !== null && typeof branch === 'object') {
        walk(branch);
      }
    }
  }

  walk(schema);
  _secretLeafNames = names;
  return names;
}

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
 * @param key - The property name (leaf name, e.g., "apiKey" or "api_key").
 * @returns `true` if the key is annotated or matches a heuristic pattern.
 */
export function isSecretKey(key: string): boolean {
  const snakeCase = toSnakeCase(key);
  const secretNames = getSecretLeafNames();
  return secretNames.has(key) || secretNames.has(snakeCase) || isHeuristicSecret(key);
}

function toSnakeCase(key: string): string {
  // Handles camelCase, PascalCase, and common acronym transitions:
  //   apiKey -> api_key
  //   ApiKey -> api_key
  //   APIKey -> api_key
  //   YTdlpPath -> ytdlp_path
  // Limit input length to prevent potential ReDoS attacks
  const MAX_KEY_LENGTH = 256;
  const trimmed = key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
  return trimmed
    .replace(/-/g, '_')
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/^_+/, '')
    .toLowerCase();
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
    if (isSecretKey(key)) {
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
