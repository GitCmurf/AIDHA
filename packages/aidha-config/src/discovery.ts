// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Config file discovery and permission checks.
 *
 * @module
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

/** Error thrown when an explicit config path override is missing. */
export class ConfigNotFoundError extends Error {
  constructor(public readonly filePath: string) {
    super(
      `Config file not found: ${filePath}. ` +
        `If you set AIDHA_CONFIG or passed an explicit config path, ensure it exists.`,
    );
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * Config file search order (first found wins):
 *   1. AIDHA_CONFIG env var (explicit override)
 *   2. ./.aidha/config.yaml (project-local)
 *   3. $XDG_CONFIG_HOME/aidha/config.yaml (XDG standard)
 *   4. ~/.config/aidha/config.yaml (XDG fallback)
 */
export function discoverConfigPath(
  envOverride?: string,
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | null {
  if (envOverride) {
    const resolved = resolve(cwd, envOverride);
    return existsSync(resolved) ? resolved : null;
  }

  const projectLocal = join(cwd, '.aidha', 'config.yaml');
  if (existsSync(projectLocal)) return projectLocal;

  const xdgHome = env['XDG_CONFIG_HOME'];
  if (xdgHome) {
    const xdgPath = join(xdgHome, 'aidha', 'config.yaml');
    if (existsSync(xdgPath)) return xdgPath;
  }

  const fallbackPath = join(homedir(), '.config', 'aidha', 'config.yaml');
  if (existsSync(fallbackPath)) return fallbackPath;

  return null;
}

/**
 * Check file permissions and warn if not 0600.
 * Returns the warning message, or null if permissions are fine.
 */
export function checkFilePermissions(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      return (
        `Config file ${filePath} has permissions ${mode.toString(8).padStart(4, '0')}, ` +
        `expected 0600. Consider running: chmod 600 ${filePath}`
      );
    }
  } catch {
  }
  return null;
}
