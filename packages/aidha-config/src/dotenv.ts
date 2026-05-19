// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Dotenv file loading with safety guardrails.
 *
 * @module
 */

import { readFileSync, lstatSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { checkFilePermissions } from './discovery.js';

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

export class DotenvRequiredError extends Error {
  constructor(public readonly filePath: string) {
    super(`Dotenv file not found: ${filePath}`);
    this.name = 'DotenvRequiredError';
  }
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

    // 1. Handle quoted values (potentially with trailing comments)
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0] as string;
      const endQuoteIdx = value.indexOf(quote, 1);
      if (endQuoteIdx !== -1) {
        // We have a matching quote.
        // Check if anything remains after it (optional comment)
        const remaining = value.slice(endQuoteIdx + 1).trim();
        if (remaining === '' || remaining.startsWith('#')) {
          result[key] = value.slice(1, endQuoteIdx);
          continue;
        }
      }
    }

    // 2. Handle unquoted values (strip inline comments)
    const commentMatch = value.match(/(?:\s)#/);
    if (commentMatch && commentMatch.index !== undefined) {
      value = value.slice(0, commentMatch.index).trim();
    }

    // 3. Strip quotes if they fully enclose the remaining value (fallback for poorly formatted lines)
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
  const resolvedBaseDir = resolve(baseDir);
  const realBaseDir = resolveRealBaseDir(resolvedBaseDir);

  const originalEnvKeys = overrideExisting
    ? null
    : new Set(Object.entries(env).filter(([, v]) => v !== undefined).map(([k]) => k));

  for (const file of files) {
    const dotenvPath = resolve(resolvedBaseDir, file);

    if (!isWithinBaseDir(dotenvPath, resolvedBaseDir)) {
      onWarning(`Dotenv file '${file}' is outside the config base directory; skipping.`);
      continue;
    }

    const resolvedDotenvPath = resolveRealDotenvPath(dotenvPath);
    if (resolvedDotenvPath && !isWithinBaseDir(resolvedDotenvPath, realBaseDir)) {
      onWarning(`Dotenv file '${dotenvPath}' resolves outside the config base directory; skipping for security.`);
      continue;
    }

    let dotenvStat: ReturnType<typeof lstatSync>;
    try {
      dotenvStat = lstatSync(dotenvPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const msg = `Dotenv file not found: ${dotenvPath}`;
        if (required) throw new DotenvRequiredError(dotenvPath);
        onWarning(msg);
      } else {
        onWarning(`Failed to stat dotenv file: ${dotenvPath}`);
      }
      continue;
    }

    if (dotenvStat.isSymbolicLink()) {
      onWarning(`Dotenv file '${dotenvPath}' is a symlink; skipping for security.`);
      continue;
    }

    if (!isSafeOwnershipStat(dotenvStat, dotenvPath, onWarning)) {
      continue;
    }

    const permWarning = checkFilePermissions(dotenvPath);
    if (permWarning) {
      onWarning(permWarning);
    }

    if (dotenvStat.size > DOTENV_MAX_FILE_SIZE) {
      onWarning(`Dotenv file '${dotenvPath}' exceeds maximum size; skipping.`);
      continue;
    }

    let content: string;
    try {
      content = readFileSync(dotenvPath, 'utf-8');
    } catch {
      onWarning(`Failed to read dotenv file: ${dotenvPath}`);
      continue;
    }

    const parsed = parseDotenvContent(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (overrideExisting || !originalEnvKeys!.has(key)) {
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
  const relativePath = relative(baseDir, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function resolveRealBaseDir(baseDir: string): string {
  try {
    return realpathSync(baseDir);
  } catch {
    return baseDir;
  }
}

function resolveRealDotenvPath(dotenvPath: string): string | undefined {
  try {
    return realpathSync(dotenvPath);
  } catch {
    return undefined;
  }
}

function isSafeOwnershipStat(
  stat: Stats,
  dotenvPath: string,
  onWarning: (msg: string) => void,
): boolean {
  if (process.platform === 'win32') return true;
  const uid = process.getuid?.();
  if (uid === undefined) return true;
  if (stat.uid === uid || stat.uid === 0) return true;
  onWarning(`Dotenv file '${dotenvPath}' is not owned by the current user or root; skipping for security.`);
  return false;
}
