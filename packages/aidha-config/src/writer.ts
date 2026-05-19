// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Safe config file writer.
 *
 * Features:
 *   - Atomic writes (write temp → rename)
 *   - Backup rotation (`.bak`, `.bak.1`, `.bak.2`)
 *   - Validation before writing
 *   - Read-only mode (`AIDHA_CONFIG_READONLY=1`)
 *   - Dry-run mode
 *   - Concurrency guard (optional etag/mtime check)
 *
 * @module
 */

import { readFileSync, writeFileSync, renameSync, existsSync, statSync, unlinkSync, chmodSync, copyFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stringify as stringifyYAML, parseDocument, isAlias, isMap, isSeq, isPair, YAMLMap, visit } from 'yaml';
import { validateConfig, validateStructure, convertValue, type ValidationResult } from './schema.js';
import { interpolateDeep } from './interpolation.js';
import type { SourceRegistration } from './types.js';

/** Helper to find a node by its anchor name. */
function findNodeByAnchor(doc: any, anchorName: string): any {
  let found: any = undefined;
  visit(doc, {
    Node: (_key, node: any) => {
      if (node.anchor === anchorName) {
        found = node;
        return visit.BREAK;
      }
    }
  });
  return found;
}


// ── Error classes ────────────────────────────────────────────────────────────

/** Error thrown when config is read-only. */
export class ConfigReadOnlyError extends Error {
  constructor() {
    super(
      'Config file is read-only (AIDHA_CONFIG_READONLY=1). ' +
        'Unset the environment variable to allow writes.',
    );
    this.name = 'ConfigReadOnlyError';
  }
}

/** Error thrown when a concurrency conflict is detected. */
export class ConfigConflictError extends Error {
  constructor(expectedMtime: number, actualMtime: number) {
    super(
      `Config file was modified externally. Expected mtime ${expectedMtime}, ` +
        `got ${actualMtime}. Re-read the config and try again.`,
    );
    this.name = 'ConfigConflictError';
  }
}

/** Error thrown when validation fails before writing. */
export class ConfigWriteValidationError extends Error {
  constructor(public readonly errors: Array<{ path: string; message: string }>) {
    const details = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    super(`Config validation failed before write:\n${details}`);
    this.name = 'ConfigWriteValidationError';
  }
}

// ── Writer options ───────────────────────────────────────────────────────────

/** Maximum number of backup files to keep. */
const MAX_BACKUPS = 3;

/** Options for writing a config file. */
export interface WriteOptions {
  /** Target file path. */
  filePath: string;
  /** The config object to write. */
  config: Record<string, unknown>;
  /** If true, only validate — don't actually write. */
  dryRun?: boolean;
  /** Expected mtime for optimistic locking (timestamp ms). */
  expectedMtime?: number;
  /** Tolerance for optimistic-lock mtime checks (default: 2000ms). */
  mtimeToleranceMs?: number;
  /** Skip schema validation before write. */
  skipValidation?: boolean;
  /** Environment map (to check AIDHA_CONFIG_READONLY). */
  env?: Record<string, string | undefined>;
  /** If true, fail when backup creation fails (default: false). */
  failOnBackupError?: boolean;
}

/** Result of a write operation. */
export interface WriteResult {
  /** Whether the write was actually performed. */
  written: boolean;
  /** Path to the backup file, if created. */
  backupPath: string | null;
  /** Validation errors, if any. */
  validationErrors: Array<{ path: string; message: string }>;
}

// ── Backup rotation ──────────────────────────────────────────────────────────

/**
 * Rotate backup files: file.bak.2 → deleted, .bak.1 → .bak.2, .bak → .bak.1
 * Then move the current file to .bak.
 */
function rotateBackups(filePath: string): string | null {
  if (!existsSync(filePath)) return null;

  const dir = dirname(filePath);
  const baseName = basename(filePath);

  // Rotate existing backups
  for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
    const from = join(dir, `${baseName}.bak${i > 1 ? `.${i - 1}` : ''}`);
    const to = join(dir, `${baseName}.bak.${i}`);
    if (existsSync(from)) {
      if (existsSync(to)) unlinkSync(to);
      renameSync(from, to);
    }
  }

  // Move current file to .bak
  const backupPath = join(dir, `${baseName}.bak`);
  try {
    const mode = statSync(filePath).mode & 0o777;
    copyFileSync(filePath, backupPath);
    try { chmodSync(backupPath, mode); } catch { /* ignore on restrictive filesystems */ }
    return backupPath;
  } catch (err) {
    // Backup failure should not necessarily block config writes in dev.
    // Allow callers to opt into a hard-fail.
    try {
      console.warn(`Failed to create backup at ${backupPath}:`, err);
    } catch {
      // ignore
    }
    return null;
  }
}

// ── Atomic write helper ───────────────────────────────────────────────────────

function atomicWriteYaml(
  tmpPath: string,
  filePath: string,
  yaml: string,
  expectedMtime?: number,
  mtimeToleranceMs = 2000,
): void {
  try {
    writeFileSync(tmpPath, yaml, { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // chmod may fail on certain filesystems; continue
    }
    if (expectedMtime !== undefined) {
      try {
        const currentMtime = statSync(filePath).mtimeMs;
        if (Math.abs(currentMtime - expectedMtime) > mtimeToleranceMs) {
          throw new ConfigConflictError(expectedMtime, currentMtime);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
      }
    }
    try {
      renameSync(tmpPath, filePath);
    } catch (err) {
      // Windows can fail to rename over an existing file; since we already
      // wrote a backup, it's safe to unlink and retry as a best-effort fallback.
      const code = (err as { code?: string } | null)?.code;
      if (code === 'EEXIST' || code === 'EPERM') {
        try {
          unlinkSync(filePath);
        } catch {
          // ignore
        }
        renameSync(tmpPath, filePath);
      } else if (code === 'EXDEV') {
        // Cross-device rename — same-dir temp path strategy should prevent this,
        // but handle defensively.
        writeFileSync(filePath, yaml, { encoding: 'utf-8', mode: 0o600 });
        try {
          chmodSync(filePath, 0o600);
        } catch {
          // ignore
        }
        unlinkSync(tmpPath);
      } else {
        throw err;
      }
    }
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

// ── Main writer ──────────────────────────────────────────────────────────────

/**
 * Write a config object to a YAML file with safety features.
 *
 * Note: The `expectedMtime` optimistic locking check reduces accidental
 * overwrite risk but is not atomic with the later write+rename (TOCTOU window).
 * Backup rotation reduces data loss risk, but concurrent writers can still race.
 * If multiple writers may update the same file concurrently, prefer external
 * coordination such as advisory file locking.
 */
export function writeConfig(options: WriteOptions): WriteResult {
  const {
    filePath,
    config,
    dryRun = false,
    expectedMtime,
    mtimeToleranceMs = 2000,
    skipValidation = false,
    env = process.env as Record<string, string | undefined>,
    failOnBackupError = false,
  } = options;

  // ── Read-only check ─────────────────────────────────────────────────
  if (env['AIDHA_CONFIG_READONLY'] === '1') {
    throw new ConfigReadOnlyError();
  }

  // ── Validation before write ─────────────────────────────────────────
  const validationErrors: Array<{ path: string; message: string }> = [];
  if (!skipValidation) {
    const result = validateConfig(config);
    if (!result.valid) {
      if (dryRun) {
        return { written: false, backupPath: null, validationErrors: result.errors };
      }
      throw new ConfigWriteValidationError(result.errors);
    }
  }

  if (dryRun) {
    return { written: false, backupPath: null, validationErrors };
  }

  // ── Backup rotation ─────────────────────────────────────────────────
  const backupPath = rotateBackups(filePath);
  if (existsSync(filePath) && backupPath === null && failOnBackupError) {
    throw new Error(`Backup creation failed for ${filePath}`);
  }

  // ── Atomic write (temp → rename) ────────────────────────────────────
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const yaml = stringifyYAML(config, {
    lineWidth: 120,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'PLAIN',
  });

  atomicWriteYaml(tmpPath, filePath, yaml, expectedMtime, mtimeToleranceMs);

  return { written: true, backupPath, validationErrors };
}

function resolveSourceOverride(
  keyPath: string,
  registrations: ReadonlyArray<SourceRegistration>,
): { sourceId: string; coercionType: 'number' | 'boolean' | 'string' } | null {
  const parts = keyPath.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'source_overrides' && i + 1 < parts.length) {
      const sourceId = parts[i + 1]!;
      const registration = registrations.find((r) => r.sourceId === sourceId);
      if (!registration?.metadata?.scalarCoercions) return null;
      const sourceKey = parts.slice(i + 2).join('.');
      const coercionType = registration.metadata.scalarCoercions[sourceKey] as 'number' | 'boolean' | 'string' | undefined;
      if (coercionType) {
        return { sourceId, coercionType };
      }
      return null;
    }
  }
  return null;
}

function convertSourceOverrideValue(
  value: string,
  coercionType: 'number' | 'boolean' | 'string',
  keyPath: string,
): unknown {
  if (coercionType === 'number') {
    if (value.trim().length === 0) {
      throw new Error(`Value for ${keyPath} cannot be empty; expected number.`);
    }
    const n = Number(value);
    if (Number.isNaN(n)) {
      throw new Error(`Invalid numeric value for ${keyPath}: "${value}"`);
    }
    return n;
  }
  if (coercionType === 'boolean') {
    const v = value.toLowerCase().trim();
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
    throw new Error(`Invalid boolean value for ${keyPath}: "${value}". Expected one of: true, false, 1, 0, yes, no, on, off.`);
  }
  return value;
}

const CORE_PROFILE_KEYS = ['db', 'llm', 'editor', 'extraction', 'export'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function pickCoreProfileFields(profile: Record<string, unknown>): Record<string, unknown> {
  const core: Record<string, unknown> = {};
  for (const key of CORE_PROFILE_KEYS) {
    if (profile[key] !== undefined) {
      core[key] = cloneValue(profile[key]);
    }
  }
  return core;
}

function getPathValue(root: unknown, pathParts: readonly string[]): unknown {
  let current = root;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function nestedRecord(pathParts: readonly string[], value: unknown): Record<string, unknown> {
  if (pathParts.length === 0) {
    return isRecord(value) ? cloneValue(value) : {};
  }

  const [head, ...tail] = pathParts;
  return {
    [head!]: tail.length === 0 ? cloneValue(value) : nestedRecord(tail, value),
  };
}

function validationResultFromError(error: unknown, path: string): ValidationResult {
  return {
    valid: false,
    errors: [{
      path,
      message: error instanceof Error ? error.message : String(error),
      keyword: 'interpolation',
    }],
  };
}

function mergeValidationResults(results: readonly ValidationResult[]): ValidationResult {
  const errors = results.flatMap((result) => result.errors);
  if (errors.length === 0) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors };
}

function validateActiveProfileCore(
  config: unknown,
  sourceRegistrations: ReadonlyArray<SourceRegistration>,
  env: Record<string, string | undefined>,
): ValidationResult {
  if (!isRecord(config)) return { valid: true, errors: [] };

  const defaultProfile = typeof config['default_profile'] === 'string'
    ? config['default_profile']
    : 'default';
  const profiles = config['profiles'];
  const profile = isRecord(profiles) && isRecord(profiles[defaultProfile])
    ? profiles[defaultProfile]
    : undefined;

  if (!profile) return { valid: true, errors: [] };

  let interpolatedProfile: Record<string, unknown>;
  try {
    interpolatedProfile = interpolateDeep(
      pickCoreProfileFields(profile),
      env,
      { rootPath: 'profiles.*' },
    ) as Record<string, unknown>;
  } catch (error) {
    return validationResultFromError(error, `/profiles/${defaultProfile}`);
  }

  return validateConfig({
    config_version: config['config_version'],
    default_profile: defaultProfile,
    profiles: {
      [defaultProfile]: interpolatedProfile,
    },
  }, sourceRegistrations);
}

function validateEditedPath(
  config: unknown,
  keyPath: string,
  sourceRegistrations: ReadonlyArray<SourceRegistration>,
): ValidationResult {
  const pathParts = keyPath.split('.');
  const value = getPathValue(config, pathParts);
  let validationConfig: Record<string, unknown>;

  if (pathParts[0] === 'profiles' && pathParts.length >= 3) {
    const profileName = pathParts[1]!;
    const profilePath = pathParts.slice(2);

    if (profilePath[0] === 'source_overrides' && profilePath.length >= 3) {
      const sourceId = profilePath[1]!;
      validationConfig = {
        config_version: 1,
        default_profile: profileName,
        profiles: {
          [profileName]: {
            source_overrides: {
              [sourceId]: nestedRecord(profilePath.slice(2), value),
            },
          },
        },
      };
    } else {
      validationConfig = {
        config_version: 1,
        default_profile: profileName,
        profiles: {
          [profileName]: nestedRecord(profilePath, value),
        },
      };
    }
  } else if (pathParts[0] === 'sources' && pathParts.length >= 3) {
    const sourceId = pathParts[1]!;
    validationConfig = {
      config_version: 1,
      default_profile: 'default',
      profiles: {
        default: {},
      },
      sources: {
        [sourceId]: nestedRecord(pathParts.slice(2), value),
      },
    };
  } else {
    validationConfig = {
      config_version: 1,
      default_profile: 'default',
      profiles: {
        default: {},
      },
    };
    let current: Record<string, unknown> = validationConfig;
    pathParts.forEach((part, index) => {
      if (index === pathParts.length - 1) {
        current[part] = cloneValue(value);
        return;
      }
      const next: Record<string, unknown> = {};
      current[part] = next;
      current = next;
    });
  }

  return validateConfig(validationConfig, sourceRegistrations);
}

function validateMutatedConfig(
  config: unknown,
  keyPath: string,
  sourceRegistrations: ReadonlyArray<SourceRegistration>,
  env: Record<string, string | undefined>,
): { valid: boolean; errors: Array<{ path: string; message: string; keyword: string }> } {
  const structural = validateStructure(config);
  if (!structural.valid) {
    return structural;
  }

  return mergeValidationResults([
    validateActiveProfileCore(config, sourceRegistrations, env),
    validateEditedPath(config, keyPath, sourceRegistrations),
  ]);
}

/** Options for mutating a config file. */
export interface MutateOptions {
  /** Target file path. */
  filePath: string;
  /** Dot-separated key path (e.g., 'profiles.local.llm.model'). */
  keyPath: string;
  /** The value to set (string from CLI, will be converted). */
  value: string;
  /** If true, only validate — don't actually write. */
  dryRun?: boolean;
  /** Skip schema validation after mutation. */
  skipValidation?: boolean;
  /** Environment map (to check AIDHA_CONFIG_READONLY). */
  env?: Record<string, string | undefined>;
  /** Source registrations for source-private field coercion and validation. */
  sourceRegistrations?: ReadonlyArray<SourceRegistration>;
}

/**
 * Mutate a config file by setting a specific key to a new value.
 * Preserves comments, anchors, and formatting by using AST-preserving updates.
 */
export function mutateConfig(options: MutateOptions): WriteResult {
  const {
    filePath,
    keyPath,
    value,
    dryRun = false,
    skipValidation = false,
    env = process.env as Record<string, string | undefined>,
    sourceRegistrations = [],
  } = options;

  if (env['AIDHA_CONFIG_READONLY'] === '1') {
    throw new ConfigReadOnlyError();
  }

  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  }

  const doc = parseDocument(content);

  const sourceOverride = resolveSourceOverride(keyPath, sourceRegistrations);

  let convertedValue: any;
  try {
    if (sourceOverride) {
      convertedValue = convertSourceOverrideValue(value, sourceOverride.coercionType, keyPath);
    } else {
      convertedValue = convertValue(keyPath, value);
    }

    // Enforce that the resulting value is a scalar (string, number, boolean)
    if (
      convertedValue !== null &&
      typeof convertedValue !== 'string' &&
      typeof convertedValue !== 'number' &&
      typeof convertedValue !== 'boolean'
    ) {
      throw new Error(`Cannot set key '${keyPath}': value must be a scalar (string, number, or boolean).`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Treat conversion errors as validation errors
    if (dryRun) {
      return {
        written: false,
        backupPath: null,
        validationErrors: [{ path: keyPath, message: msg }],
      };
    }
    throw new ConfigWriteValidationError([{ path: keyPath, message: msg }]);
  }

  // ── Manual traversal to handle Aliases ──────────────────────────────
  // doc.setIn fails if the path traverses an Alias node. We must resolve
  // aliases manually to reach the mutable target node.
  // "Break Alias": If we encounter an alias on the write path, we replace
  // it with a clone of its target to ensure we don't mutate the anchor shared by others.

  const pathParts = keyPath.split('.');
  if (pathParts.some(p => !p.trim())) {
    throw new Error(`Invalid keyPath '${keyPath}': segments cannot be empty.`);
  }

  const lastKey = pathParts.pop()!; // specific key to set

  let current: any = doc.contents;
  if (!current) {
      // Initialize contents if missing, even for root keys
      doc.contents = new YAMLMap() as any;
      current = doc.contents;
  }

  let parent: any = doc;
  let parentKey: any = 'contents'; // Special indicator for doc.contents

  // Helper to replace current alias with clone
  const breakAlias = (aliasNode: any) => {
    const anchorName = aliasNode.source;
    const targetNode = findNodeByAnchor(doc, anchorName);

    if (!targetNode) {
       // Cannot resolve? We can't safely define behavior.
       return null;
    }

    // Clone the target node to break the link
    if (!targetNode.clone || typeof targetNode.clone !== 'function') {
        throw new Error(`Cannot safely write to alias '${keyPath}': target node does not support cloning.`);
    }

    const clone = targetNode.clone();

    // Clear anchor on the clone to avoid duplication
    if (clone.anchor) clone.anchor = undefined;

    // Replace in parent
    if (parentKey === 'contents') {
      doc.contents = clone;
    } else if (isMap(parent)) {
      parent.set(parentKey, clone);
    } // (We don't expect Seq parents for config keys usually)

    return clone;
  };


  // traverse to the parent container of the target key
  for (const part of pathParts) {
    if (!current) break;

    // Break Alias if encountered
    if (isAlias(current)) {
      const clone = breakAlias(current);
      if (clone) {
        current = clone;
      } else {
        // Anchor resolving failed
        current = undefined;
        break;
      }
    }

    if (isMap(current)) {
      if (!current.has(part)) {
        // Create missing intermediate node
        const newMap = new YAMLMap();
        current.set(part, newMap);

        // Prepare for next step
        parent = current;
        parentKey = part;
        current = newMap;
      } else {
        // Prepare for next step
        parent = current;
        parentKey = part;
        current = current.get(part, true); // keep node check for alias next
      }
    } else {
       current = undefined;
       break;
    }
  }

  // Final resolution regarding the container itself
  // If the container we landed on involves an alias, break it too.
  if (current && isAlias(current)) {
     const clone = breakAlias(current);
     if (clone) current = clone;
  }

  if (current && isMap(current)) {
    current.set(lastKey, convertedValue);
  } else {
    // If we failed to reach a Map, throw
    throw new Error(`Cannot set key '${keyPath}': path traversal failed or target is not a map.`);
  }

  const mutatedConfig = doc.toJS() as Record<string, unknown>;

  // ── Validation after mutation ───────────────────────────────────────
  const validationErrors: Array<{ path: string; message: string }> = [];
  if (!skipValidation) {
    const result = validateMutatedConfig(mutatedConfig, keyPath, sourceRegistrations, env);
    if (!result.valid) {
      if (dryRun) {
        return { written: false, backupPath: null, validationErrors: result.errors };
      }
      throw new ConfigWriteValidationError(result.errors);
    }
  }

  if (dryRun) {
    return { written: false, backupPath: null, validationErrors };
  }

  const backupPath = rotateBackups(filePath);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  atomicWriteYaml(tmpPath, filePath, doc.toString());

  return { written: true, backupPath, validationErrors };
}
