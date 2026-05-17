// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Dotenv file loading with safety guardrails.
 *
 * @module
 */

import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DotenvLoadOptions {
  files: string[];
  baseDir: string;
  env: Record<string, string | undefined>;
  overrideExisting: boolean;
  required: boolean;
  syncProcessEnv: boolean;
  onWarning: (msg: string) => void;
}

export interface DotenvLoadResult {
  dotenvEnv: Record<string, string>;
  env: Record<string, string | undefined>;
}

const DOTENV_MAX_FILE_SIZE = 65_536;

export function parseDotenvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadDotenvFiles(options: DotenvLoadOptions): DotenvLoadResult {
  const { files, baseDir, env, overrideExisting, required, syncProcessEnv, onWarning } = options;
  const dotenvEnv: Record<string, string> = {};

  const originalEnvKeys = new Set(
    Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k),
  );

  for (const file of files) {
    const dotenvPath = resolve(baseDir, file);

    if (!isWithinBaseDir(dotenvPath, baseDir)) {
      onWarning(`Dotenv file '${file}' is outside the config base directory; skipping.`);
      continue;
    }

    if (!existsSync(dotenvPath)) {
      const msg = `Dotenv file not found: ${dotenvPath}`;
      if (required) {
        throw new Error(msg);
      }
      onWarning(msg);
      continue;
    }

    if (isSymlink(dotenvPath)) {
      onWarning(`Dotenv file '${dotenvPath}' is a symlink; skipping for security.`);
      continue;
    }

    if (!isSafeOwnership(dotenvPath)) {
      onWarning(
        `Dotenv file '${dotenvPath}' is not owned by the current user or root; skipping for security.`,
      );
      continue;
    }


    let content: string;
    try {
      content = readFileSync(dotenvPath, 'utf-8');
    } catch {
      onWarning(`Failed to read dotenv file: ${dotenvPath}`);
      continue;
    }

    if (Buffer.byteLength(content, 'utf-8') > DOTENV_MAX_FILE_SIZE) {
      onWarning(`Dotenv file '${dotenvPath}' exceeds maximum size; skipping.`);
      continue;
    }

    const parsed = parseDotenvContent(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (overrideExisting || !originalEnvKeys.has(key)) {
        env[key] = value;
        dotenvEnv[key] = value;
        if (syncProcessEnv) {
          process.env[key] = value;
        }
      }
    }
  }

  return { dotenvEnv, env };
}

function isWithinBaseDir(filePath: string, baseDir: string): boolean {
  const resolved = resolve(filePath);
  const resolvedBase = resolve(baseDir);
  return resolved.startsWith(resolvedBase + '/') || resolved === resolvedBase;
}

function isSymlink(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isSafeOwnership(filePath: string): boolean {
  if (process.platform === 'win32') return true;
  try {
    const stat = lstatSync(filePath);
    const uid = process.getuid?.();
    // Safety check for uid being defined (should be on POSIX)
    if (uid === undefined) return true;
    return stat.uid === uid || stat.uid === 0; // Current user or root
  } catch {
    return false;
  }
}
