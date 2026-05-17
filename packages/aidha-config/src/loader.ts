// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Config file loader orchestration.
 *
 * Delegates to discovery.ts, parser.ts, and dotenv.ts for individual
 * pipeline steps. This module is orchestration-only.
 *
 * Pipeline:
 *   1. Discover config file path (discovery.ts)
 *   2. Compute `base_dir_prelim` (paths.ts)
 *   3. Parse YAML into raw object (parser.ts)
 *   3.5. Structural validation — pass 1 (schema.ts)
 *   4. Load dotenv files (dotenv.ts)
 *   5. Interpolate top-level fields needed for resolution (base_dir, default_profile)
 *   6. Compute final `base_dir`
 *
 * Full interpolation and semantic validation are deferred to resolver.ts (lazy).
 *
 * @module
 */

import { validateStructure } from './schema.js';
import { interpolateString } from './interpolation.js';
import { computeBaseDirPrelim, computeFinalBaseDir } from './paths.js';
import { SUPPORTED_CONFIG_VERSION } from './types.js';
import type { AidhaConfig, ConfigLogSink } from './types.js';
import { discoverConfigPath, checkFilePermissions, ConfigNotFoundError } from './discovery.js';
export { ConfigNotFoundError } from './discovery.js';
export { ConfigParseError } from './parser.js';
import { parseConfigYaml } from './parser.js';
import { loadDotenvFiles } from './dotenv.js';

// ── Error classes (loader-specific) ──────────────────────────────────────────

/** Error thrown when config file fails schema validation. */
export class ConfigValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly errors: Array<{ path: string; message: string }>,
  ) {
    const details = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    super(`Config validation failed for ${filePath}:\n${details}`);
    this.name = 'ConfigValidationError';
  }
}

/** Error thrown when config_version is unsupported. */
export class ConfigVersionError extends Error {
  constructor(public readonly filePath: string, fileVersion: number, supported: number) {
    super(
      `Config file declares config_version: ${fileVersion}, but this binary ` +
        `only supports version ${supported}. Please update your binary or ` +
        `run \`aidha config init\` to generate a compatible config file.`,
    );
    this.name = 'ConfigVersionError';
  }
}

// ── Re-exports for backward compatibility ────────────────────────────────────

export { discoverConfigPath, checkFilePermissions } from './discovery.js';

// ── Main loader ──────────────────────────────────────────────────────────────

/** Options for the config loader. */
export interface LoadOptions {
  /** Override config file path (AIDHA_CONFIG). */
  configPath?: string;
  /** Override cwd for file discovery. */
  cwd?: string;
  /** Environment map for interpolation and discovery. */
  env?: Record<string, string | undefined>;
  /** If true, copy dotenv-loaded keys into process.env. */
  syncProcessEnv?: boolean;
  /** Callback for non-fatal warnings (permissions, missing dotenv). */
  onWarning?: (message: string) => void;
  /** Callback for structured configuration events. */
  logSink?: ConfigLogSink;
}

/** Result of loading a config file. */
export interface LoadResult {
  /** The parsed, interpolated, validated config. Null if no file found. */
  config: AidhaConfig | null;
  /** Absolute path to the config file, or null if not found. */
  configPath: string | null;
  /** The resolved base directory. */
  baseDir: string;
  /** Any warnings generated during loading. */
  warnings: string[];
  /** Key-value pairs loaded from dotenv files (not originally in the env map). */
  dotenvEnv: Record<string, string>;
}

/**
 * Load and process a config file using the full pipeline.
 */
export async function loadConfig(options: LoadOptions = {}): Promise<LoadResult> {
  const {
    configPath: configPathOverride,
    cwd = process.cwd(),
    env = { ...process.env } as Record<string, string | undefined>,
    syncProcessEnv = false,
    onWarning,
    logSink,
  } = options;

  const warnings: string[] = [];
  const warn = (msg: string, code = 'LOAD_WARNING'): void => {
    warnings.push(msg);
    onWarning?.(msg);
    logSink?.({
      type: 'config.load.warning',
      code,
      message: msg,
      configPath: configPath ?? undefined,
    });
  };

  // ── Step 1: Discover config file ────────────────────────────────────
  const explicitPath = configPathOverride ?? env['AIDHA_CONFIG'];
  const configPath = discoverConfigPath(explicitPath, cwd, env);

  if (!configPath) {
    if (explicitPath) {
      throw new ConfigNotFoundError(explicitPath);
    }
    return { config: null, configPath: null, baseDir: cwd, warnings, dotenvEnv: {} };
  }

  // ── Step 2: Compute base_dir_prelim ─────────────────────────────────
  const baseDirPrelim = computeBaseDirPrelim(configPath);

  const permWarning = checkFilePermissions(configPath);
  if (permWarning) warn(permWarning, 'FILE_PERMISSIONS');

  // ── Step 3: Parse YAML ──────────────────────────────────────────────
  const rawObj = parseConfigYaml(configPath);

  // ── Step 3.5: Structural validation (pass 1) ────────────────────────
  const structuralResult = validateStructure(rawObj);
  if (!structuralResult.valid) {
    throw new ConfigValidationError(configPath, structuralResult.errors);
  }

  // ── Step 4: Load dotenv files (if configured) ───────────────────────
  let dotenvEnv: Record<string, string> = {};
  const envRaw = rawObj['env'];
  const envConfig =
    envRaw !== null && typeof envRaw === 'object' && !Array.isArray(envRaw)
      ? (envRaw as Record<string, unknown>)
      : undefined;
  const dotenvFilesRaw = envConfig?.['dotenv_files'];
  if (Array.isArray(dotenvFilesRaw)) {
    const dotenvErrors: Array<{ path: string; message: string }> = [];
    const files: string[] = [];
    for (let index = 0; index < dotenvFilesRaw.length; index += 1) {
      const entry = dotenvFilesRaw[index];
      if (typeof entry !== 'string') {
        dotenvErrors.push({
          path: `/env/dotenv_files/${index}`,
          message: 'must be a string',
        });
        continue;
      }
      files.push(entry);
    }

    if (dotenvErrors.length > 0) {
      throw new ConfigValidationError(configPath, dotenvErrors);
    }

    const dotenvResult = loadDotenvFiles({
      files,
      baseDir: baseDirPrelim,
      env,
      overrideExisting: envConfig!['override_existing'] === true,
      required: envConfig!['dotenv_required'] === true,
      syncProcessEnv,
      onWarning: (m) => warn(m, 'DOTENV_LOAD'),
    });
    dotenvEnv = dotenvResult.dotenvEnv;
  }

  // ── Step 5: Interpolate top-level fields needed for resolution ──────
  const baseDirOverrideRaw = rawObj['base_dir'];
  const baseDirOverride = typeof baseDirOverrideRaw === 'string'
    ? interpolateString(baseDirOverrideRaw, env)
    : undefined;

  const defaultProfileRaw = rawObj['default_profile'];
  const defaultProfile = typeof defaultProfileRaw === 'string'
    ? interpolateString(defaultProfileRaw, env)
    : undefined;

  const config = rawObj as unknown as AidhaConfig;
  if (baseDirOverride !== undefined) config.base_dir = baseDirOverride;
  if (defaultProfile !== undefined) config.default_profile = defaultProfile;

  if (config.config_version !== SUPPORTED_CONFIG_VERSION) {
    throw new ConfigVersionError(configPath, config.config_version, SUPPORTED_CONFIG_VERSION);
  }

  // ── Step 7: Compute final base_dir ──────────────────────────────────
  const baseDir = computeFinalBaseDir(baseDirPrelim, config.base_dir);
  config.base_dir = baseDir;

  return { config, configPath, baseDir, warnings, dotenvEnv };
}
