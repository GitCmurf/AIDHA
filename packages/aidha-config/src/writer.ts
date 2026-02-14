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

import { readFileSync, writeFileSync, renameSync, existsSync, statSync, unlinkSync, chmodSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stringify as stringifyYAML, parseDocument, isAlias, isMap, isSeq, isPair, YAMLMap, visit } from 'yaml';
import { validateConfig, convertValue } from './schema.js';

// ... (existing helper methods if any)

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
    // Copy content to preserve the original file during atomic write
    const mode = statSync(filePath).mode & 0o777;
    const content = readFileSync(filePath, 'utf-8');
    writeFileSync(backupPath, content, { encoding: 'utf-8', mode });
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

  // ── Concurrency guard (optimistic locking) ──────────────────────────
  if (expectedMtime !== undefined) {
    try {
      const currentMtime = statSync(filePath).mtimeMs;
      if (Math.abs(currentMtime - expectedMtime) > mtimeToleranceMs) {
        throw new ConfigConflictError(expectedMtime, currentMtime);
      }
    } catch (err) {
      // File doesn't exist (or was deleted) so there's nothing to lock against.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  // ── Backup rotation ─────────────────────────────────────────────────
  const backupPath = rotateBackups(filePath);
  if (existsSync(filePath) && backupPath === null && failOnBackupError) {
    throw new Error(`Backup creation failed for ${filePath}`);
  }

  // ── Atomic write (temp → rename) ────────────────────────────────────
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  const yaml = stringifyYAML(config, {
    lineWidth: 120,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'PLAIN',
  });

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
        // Cross-device rename. This should not occur with our temp path strategy
        // (same directory as destination), but handle defensively.
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
    // Clean up orphaned tmp file on any failure (permissions, cross-device, etc.)
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }

  return { written: true, backupPath, validationErrors };
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
  } = options;

  // ── Read-only check ─────────────────────────────────────────────────
  if (env['AIDHA_CONFIG_READONLY'] === '1') {
    throw new ConfigReadOnlyError();
  }

  // ── Load and Mutate ─────────────────────────────────────────────────
  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  }

  const doc = parseDocument(content);

  let convertedValue: any;
  try {
    convertedValue = convertValue(keyPath, value);
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
    const result = validateConfig(mutatedConfig);
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

  // ── Write mutated YAML ──────────────────────────────────────────────
  // We reuse the atomic write logic by calling writeConfig with the mutated doc
  // but we want to use doc.toString() instead of stringifyYAML(config) to preserve style.
  // So we'll manually perform the write/backup here to avoid re-serializing style-free.

  // ── Backup rotation ─────────────────────────────────────────────────
  const backupPath = rotateBackups(filePath);

  // ── Atomic write (temp → rename) ────────────────────────────────────
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  const yaml = doc.toString();

  try {
    writeFileSync(tmpPath, yaml, { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // ignore
    }
    try {
      renameSync(tmpPath, filePath);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'EEXIST' || code === 'EPERM') {
        try {
          unlinkSync(filePath);
        } catch {
          // ignore
        }
        renameSync(tmpPath, filePath);
      } else if (code === 'EXDEV') {
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
      // ignore
    }
    throw err;
  }

  return { written: true, backupPath, validationErrors };
}
