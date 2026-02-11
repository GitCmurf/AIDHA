/**
 * @aidha/config — Config file loader with full 8-step pipeline.
 *
 * Load order:
 *   1. Discover config file path.
 *   2. Compute `base_dir_prelim` from config file path.
 *   3. Parse YAML into raw object.
 *   4. If `env.dotenv_files` is present, load those .env files in order.
 *   5. Apply `${VAR}` interpolation to string values.
 *   6. Validate interpolated config against JSON schema.
 *   7. Compute final `base_dir` (with optional override).
 *   8. Resolve path-like config values relative to final `base_dir`.
 *
 * @module
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYAML } from 'yaml';
import { validateConfig } from './schema.js';
import { interpolateDeep } from './interpolation.js';
import { computeBaseDirPrelim, computeFinalBaseDir, resolvePathValues } from './paths.js';
import { SUPPORTED_CONFIG_VERSION } from './types.js';
import type { AidhaConfig } from './types.js';

// ── Error classes ────────────────────────────────────────────────────────────

/** Error thrown when config file has invalid YAML. */
export class ConfigParseError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(`Failed to parse config file: ${filePath}`);
    this.name = 'ConfigParseError';
    this.cause = cause;
  }
}

/** Error thrown when config file fails schema validation. */
export class ConfigValidationError extends Error {
  constructor(
    filePath: string,
    public readonly errors: Array<{ path: string; message: string }>,
  ) {
    const details = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    super(`Config validation failed for ${filePath}:\n${details}`);
    this.name = 'ConfigValidationError';
  }
}

/** Error thrown when config_version is unsupported. */
export class ConfigVersionError extends Error {
  constructor(fileVersion: number, supported: number) {
    super(
      `Config file declares config_version: ${fileVersion}, but this binary ` +
        `only supports version ${supported}. Please update your binary or ` +
        `run \`aidha config init\` to generate a compatible config file.`,
    );
    this.name = 'ConfigVersionError';
  }
}

/** Error thrown when an explicit config path override is missing. */
export class ConfigNotFoundError extends Error {
  constructor(filePath: string) {
    super(
      `Config file not found: ${filePath}. ` +
        `If you set AIDHA_CONFIG or passed an explicit config path, ensure it exists.`,
    );
    this.name = 'ConfigNotFoundError';
  }
}

// ── File discovery ───────────────────────────────────────────────────────────

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
): string | null {
  // 1. Explicit env override
  if (envOverride) {
    const resolved = resolve(envOverride);
    return existsSync(resolved) ? resolved : null;
  }

  // 2. Project-local
  const projectLocal = join(cwd, '.aidha', 'config.yaml');
  if (existsSync(projectLocal)) return projectLocal;

  // 3. XDG_CONFIG_HOME
  const xdgHome = process.env['XDG_CONFIG_HOME'];
  if (xdgHome) {
    const xdgPath = join(xdgHome, 'aidha', 'config.yaml');
    if (existsSync(xdgPath)) return xdgPath;
  }

  // 4. XDG fallback
  const fallbackPath = join(homedir(), '.config', 'aidha', 'config.yaml');
  if (existsSync(fallbackPath)) return fallbackPath;

  return null;
}

// ── Permission warning ──────────────────────────────────────────────────────

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
    // Can't check permissions — skip silently
  }
  return null;
}

// ── Main loader ──────────────────────────────────────────────────────────────

/** Options for the config loader. */
export interface LoadOptions {
  /** Override config file path (AIDHA_CONFIG). */
  configPath?: string;
  /** Override cwd for file discovery. */
  cwd?: string;
  /** Environment map for interpolation and discovery. */
  env?: Record<string, string | undefined>;
  /** Callback for non-fatal warnings (permissions, missing dotenv). */
  onWarning?: (message: string) => void;
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
}

/**
 * Load and process a config file using the full 8-step pipeline.
 */
export async function loadConfig(options: LoadOptions = {}): Promise<LoadResult> {
  const {
    configPath: configPathOverride,
    cwd = process.cwd(),
    // Always work on a copy so we never mutate the caller's env (or
    // process.env when no explicit env is provided).
    env = { ...process.env } as Record<string, string | undefined>,
    onWarning,
  } = options;

  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
    onWarning?.(msg);
  };

  // ── Step 1: Discover config file ────────────────────────────────────
  const explicitPath = configPathOverride ?? env['AIDHA_CONFIG'];
  const configPath = discoverConfigPath(
    explicitPath,
    cwd,
  );

  if (!configPath) {
    if (explicitPath) {
      throw new ConfigNotFoundError(explicitPath);
    }
    return { config: null, configPath: null, baseDir: cwd, warnings };
  }

  // ── Step 2: Compute base_dir_prelim ─────────────────────────────────
  const baseDirPrelim = computeBaseDirPrelim(configPath);

  // Check file permissions
  const permWarning = checkFilePermissions(configPath);
  if (permWarning) warn(permWarning);

  // ── Step 3: Parse YAML ──────────────────────────────────────────────
  let raw: unknown;
  try {
    const content = readFileSync(configPath, 'utf-8');
    raw = parseYAML(content);
  } catch (err) {
    throw new ConfigParseError(configPath, err);
  }

  if (raw === null || typeof raw !== 'object') {
    throw new ConfigParseError(configPath, new Error('Config file is empty or not an object'));
  }

  const rawObj = raw as Record<string, unknown>;

  // ── Step 4: Load dotenv files (if configured) ───────────────────────
  const envRaw = rawObj['env'];
  const envConfig =
    envRaw !== null && typeof envRaw === 'object' && !Array.isArray(envRaw)
      ? (envRaw as Record<string, unknown>)
      : undefined;
  const dotenvFilesRaw = envConfig?.['dotenv_files'];
  if (Array.isArray(dotenvFilesRaw)) {
    const files = dotenvFilesRaw.filter((f): f is string => typeof f === 'string');
    const skipped = dotenvFilesRaw.length - files.length;
    if (skipped > 0) {
      warn(`Ignoring ${skipped} non-string dotenv_files entries.`);
    }
    const overrideExisting = envConfig!['override_existing'] === true;
    const required = envConfig!['dotenv_required'] === true;

    // Snapshot original env keys so later dotenv files can override
    // earlier ones, but pre-existing process env vars are protected
    // when override_existing is false.
    const originalEnvKeys = new Set(
      Object.entries(env)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
    );

    for (const file of files) {
      const dotenvPath = resolve(baseDirPrelim, file);
      if (!existsSync(dotenvPath)) {
        const msg = `Dotenv file not found: ${dotenvPath}`;
        if (required) {
          throw new Error(msg);
        }
        warn(msg);
        continue;
      }

      // Simple .env parser (key=value lines, ignoring comments and blanks)
      const content = readFileSync(dotenvPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        // Later dotenv files always override earlier dotenv files.
        // Only protect pre-existing process env vars when override_existing is false.
        if (overrideExisting || !originalEnvKeys.has(key)) {
          env[key] = value;
        }
      }
    }
  }

  // ── Step 5: Interpolate ${VAR} references ───────────────────────────
  const interpolated = interpolateDeep(rawObj, env);

  // ── Step 6: Validate against JSON Schema ────────────────────────────
  const validation = validateConfig(interpolated);
  if (!validation.valid) {
    throw new ConfigValidationError(configPath, validation.errors);
  }

  const config = interpolated as unknown as AidhaConfig;

  // Check config_version
  if (config.config_version !== SUPPORTED_CONFIG_VERSION) {
    throw new ConfigVersionError(config.config_version, SUPPORTED_CONFIG_VERSION);
  }

  // ── Step 7: Compute final base_dir ──────────────────────────────────
  const baseDir = computeFinalBaseDir(baseDirPrelim, config.base_dir);

  // ── Step 8: Resolve path-like values ────────────────────────────────
  resolvePathValues(config as unknown as Record<string, unknown>, baseDir);

  return { config, configPath, baseDir, warnings };
}
