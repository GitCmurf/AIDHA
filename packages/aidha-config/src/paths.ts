// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Path resolution utilities.
 *
 * Handles `base_dir` computation (prelim and final) and resolves
 * config values annotated with `x-aidha-path: true` in the JSON Schema.
 *
 * @module
 */

import { resolve, dirname, sep } from 'node:path';
import { PATH_PATTERNS, RUNTIME_PATH_PATTERNS } from './schema.generated.js';

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
 * Consumes both PATH_PATTERNS (on-disk) and RUNTIME_PATH_PATTERNS (runtime)
 * from schema.generated.ts to identify which fields should be resolved as paths.
 *
 * @param config  - The parsed config object (mutated in-place for performance).
 * @param baseDir - The resolved base directory.
 * @returns The same config object with path values resolved.
 */
export function resolvePathValues<T extends Record<string, unknown>>(
  config: T,
  baseDir: string,
): T {
  function walk(obj: unknown, currentPath: string[]): void {
    if (obj === null || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item, [...currentPath, '*']);
      }
      return;
    }

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const nextPath = [...currentPath, key];
      // `base_dir` has dedicated resolution semantics in loader.ts and should
      // never be re-resolved here.
      if (nextPath.length === 1 && nextPath[0] === 'base_dir') {
        continue;
      }

      const isMatch =
        PATH_PATTERNS.some((p) => matchesPathPattern(p, nextPath)) ||
        RUNTIME_PATH_PATTERNS.some((p) => matchesPathPattern(p, nextPath));

      if (typeof value === 'string' && isMatch) {
        record[key] = resolvePathValue(value, baseDir);
      } else if (typeof value === 'object' && value !== null) {
        walk(value, nextPath);
      }
    }
  }

  walk(config, []);
  return config;
}

function matchesPathPattern(pattern: string[], actualPath: string[]): boolean {
  if (pattern.length !== actualPath.length) return false;
  for (let idx = 0; idx < pattern.length; idx += 1) {
    if (pattern[idx] !== '*' && pattern[idx] !== actualPath[idx]) {
      return false;
    }
  }
  return true;
}
