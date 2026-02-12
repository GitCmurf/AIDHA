/**
 * @aidha/config — Path resolution utilities.
 *
 * Handles `base_dir` computation (prelim and final) and resolves
 * config values annotated with `x-aidha-path: true` in the JSON Schema.
 *
 * @module
 */

import { resolve, dirname, sep } from 'node:path';
import { loadSchema } from './schema.js';

/**
 * Compute `base_dir_prelim` from the config file path.
 *
 * If the config lives inside `.aidha/` (project-local), the base dir is the
 * project root (parent of `.aidha/`). Otherwise, the base dir is the
 * directory containing the config file.
 *
 * @param configFilePath - Absolute path to the config file.
 * @returns The preliminary base directory (always absolute).
 */
export function computeBaseDirPrelim(configFilePath: string): string {
  const configDir = dirname(configFilePath);
  // If the config file is inside a `.aidha/` directory, use the parent
  // as the project root.
  if (configDir.endsWith(`${sep}.aidha`) || configDir.endsWith('/.aidha')) {
    return dirname(configDir);
  }
  return configDir;
}

/**
 * Compute the final `base_dir` from `base_dir_prelim` and an optional
 * user-specified `base_dir` override from the config file.
 *
 * @param baseDirPrelim  - The preliminary base directory.
 * @param baseDirOverride - Optional `base_dir` value from the config file.
 * @returns The final base directory (always absolute).
 */
export function computeFinalBaseDir(
  baseDirPrelim: string,
  baseDirOverride?: string,
): string {
  if (!baseDirOverride) return baseDirPrelim;
  return resolve(baseDirPrelim, baseDirOverride);
}

/**
 * Collect the dot-notation paths of all schema properties annotated
 * with `x-aidha-path: true`. Results are cached after first call.
 */
let _pathKeys: string[] | undefined;

export function getPathAnnotatedKeys(): string[] {
  if (_pathKeys) return _pathKeys;

  const schema = loadSchema();
  const paths: string[] = [];

  function walk(obj: unknown, jsonPath: string): void {
    if (obj === null || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;

    if (record['x-aidha-path'] === true && jsonPath !== '') {
      paths.push(jsonPath);
    }

    // Walk into `properties`
    if (typeof record['properties'] === 'object' && record['properties'] !== null) {
      for (const [key, val] of Object.entries(record['properties'] as Record<string, unknown>)) {
        walk(val, jsonPath ? `${jsonPath}.${key}` : key);
      }
    }

    // Walk into `$defs`
    if (typeof record['$defs'] === 'object' && record['$defs'] !== null) {
      for (const [, val] of Object.entries(record['$defs'] as Record<string, unknown>)) {
        walk(val, jsonPath);
      }
    }

    // Walk into `additionalProperties` when it references a $def
    if (typeof record['additionalProperties'] === 'object' && record['additionalProperties'] !== null) {
      walk(record['additionalProperties'], jsonPath);
    }
  }

  walk(schema, '');
  _pathKeys = paths;
  return paths;
}

/**
 * Determine whether a value should be treated as a filesystem path
 * or a bare command name (suitable for PATH resolution).
 *
 * A bare command contains no path separators.
 * Examples: `yt-dlp` → bare; `./bin/yt-dlp` → path; `/usr/bin/yt-dlp` → path.
 */
export function isBareCommand(value: string): boolean {
  return (
    value !== '' &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes(sep)
  );
}

/**
 * Resolve a single path-like value relative to `baseDir`, unless it is
 * already absolute or is a bare command name.
 */
export function resolvePathValue(value: string, baseDir: string): string {
  if (value === '') return value;
  if (isBareCommand(value)) return value;
  return resolve(baseDir, value);
}

/**
 * Recursively resolve all path-like values in a config object.
 *
 * For dynamic structures (profiles and sources), we can't rely solely on
 * schema JSON-pointer paths because profile/source names are dynamic keys.
 * Instead, we walk the config object and check property names against the
 * known path-annotated leaf names extracted from the schema's $defs.
 *
 * @param config  - The parsed config object (mutated in-place for performance).
 * @param baseDir - The resolved base directory.
 * @returns The same config object with path values resolved.
 */
export function resolvePathValues<T extends Record<string, unknown>>(
  config: T,
  baseDir: string,
): T {
  // Extract leaf property names that are path-annotated in any $def
  const pathLeafNames = getPathLeafNames();

  function walk(obj: unknown, currentPath: string): void {
    if (obj === null || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item, currentPath);
      }
      return;
    }

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      // `base_dir` has dedicated resolution semantics in loader.ts and should
      // never be re-resolved here.
      if (nextPath === 'base_dir') {
        continue;
      }
      if (typeof value === 'string' && pathLeafNames.has(key)) {
        record[key] = resolvePathValue(value, baseDir);
      } else if (typeof value === 'object' && value !== null) {
        walk(value, nextPath);
      }
    }
  }

  walk(config, '');
  return config;
}

/**
 * Extract the set of leaf property names that have `x-aidha-path: true`
 * from the schema's `$defs` and top-level properties.
 */
let _pathLeafNames: Set<string> | undefined;

function getPathLeafNames(): Set<string> {
  if (_pathLeafNames) return _pathLeafNames;

  const schema = loadSchema();
  const names = new Set<string>();

  function walk(obj: unknown): void {
    if (obj === null || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;

    if (typeof record['properties'] === 'object' && record['properties'] !== null) {
      for (const [key, val] of Object.entries(record['properties'] as Record<string, unknown>)) {
        if (val !== null && typeof val === 'object' && (val as Record<string, unknown>)['x-aidha-path'] === true) {
          names.add(key);
        }
        walk(val);
      }
    }

    if (typeof record['$defs'] === 'object' && record['$defs'] !== null) {
      for (const [, val] of Object.entries(record['$defs'] as Record<string, unknown>)) {
        walk(val);
      }
    }
  }

  walk(schema);
  _pathLeafNames = names;
  return names;
}
