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
import { stringify as stringifyYAML } from 'yaml';
import { validateConfig } from './schema.js';

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
  constructor(errors: Array<{ path: string; message: string }>) {
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
