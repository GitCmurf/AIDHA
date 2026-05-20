import {
  validateConfig,
  interpolateDeep,
  formatProvenance,
  resolveKeyProvenance,
  redactSecrets,
  isSecretKey,
  REDACTED,
  ConfigValidationError,
  ConfigWriteValidationError,
  mutateConfig,
  resolveConfig,
  DEFAULTS,
} from '@aidha/config';
import type { LoadResult, ResolvedConfig, Profile } from '@aidha/config';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { CliOptions } from '../cli.js'; // Import CliOptions
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dump as dumpYaml } from 'js-yaml'; // Restore dumpYaml
import { buildCliOverrides, buildResolvedEnv } from './config-bridge.js'; // Restore buildCliOverrides
import { YouTubeSourceRegistration, resolveRawYoutubeActiveSourceConfigPaths } from '../config/index.js';

// Function to get a value from an object (deep)
function deepGet(obj: unknown, path: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return path.split('.').reduce((acc: any, part) => acc && acc[part], obj);
}

function optionString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

function redactResolvedConfigForDisplay(value: ResolvedConfig): ResolvedConfig {
  const { activeSourceConfig, ...coreConfig } = value as unknown as Record<string, unknown>;
  const redacted = redactSecrets(coreConfig) as unknown as Record<string, unknown>;

  if (activeSourceConfig === undefined || activeSourceConfig === null) {
    return redacted as unknown as ResolvedConfig;
  }

  const sourceIdValue = redacted['activeSourceId'];
  const sourceId = typeof sourceIdValue === 'string' ? sourceIdValue : undefined;
  if (sourceId === YouTubeSourceRegistration.sourceId) {
    const narrowed = YouTubeSourceRegistration.validateActiveSourceConfig(activeSourceConfig);
    redacted['activeSourceConfig'] = YouTubeSourceRegistration.redactActiveSourceConfig!(narrowed);
    return redacted as unknown as ResolvedConfig;
  }

  redacted['activeSourceConfig'] = redactSecrets(activeSourceConfig);
  return redacted as unknown as ResolvedConfig;
}

function isDiffLeaf(value: unknown): value is { from: unknown; to: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'from') &&
    Object.hasOwn(value, 'to') &&
    Object.keys(value).length === 2
  );
}

function isSecretDiffPath(path: string): boolean {
  const leafKey = path.split('.').pop();
  return leafKey ? isSecretKey(leafKey) : false;
}

function redactDiffForDisplay(value: unknown, path = ''): unknown {
  if (isDiffLeaf(value)) {
    if (isSecretDiffPath(path)) {
      return { from: REDACTED, to: REDACTED };
    }

    return {
      from: typeof value.from === 'object' && value.from !== null ? redactSecrets(value.from) : value.from,
      to: typeof value.to === 'object' && value.to !== null ? redactSecrets(value.to) : value.to,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactDiffForDisplay(item, `${path}[${index}]`));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = redactDiffForDisplay(nested, path ? `${path}.${key}` : key);
  }
  return redacted;
}

type ValidationIssue = {
  path: string;
  message: string;
};

function prepareConfigForValidation(loadResult: LoadResult): { config: Record<string, unknown> | null; issues: ValidationIssue[] } {
  if (!loadResult.config) {
    return { config: null, issues: [] };
  }

  const env = buildResolvedEnv(loadResult);
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  const pushIssue = (path: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const fingerprint = `${path}\u0000${message}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    issues.push({ path, message });
  };

  const config = structuredClone(loadResult.config) as unknown as Record<string, unknown>;

  if (config['sources'] && typeof config['sources'] === 'object') {
    for (const [sourceId, sourceConfig] of Object.entries(config['sources'] as Record<string, unknown>)) {
      if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) continue;
      try {
        (config['sources'] as Record<string, unknown>)[sourceId] = interpolateDeep(sourceConfig, env, { rootPath: 'sources.*', tolerant: false });
      } catch (error) {
        pushIssue(`/sources/${sourceId}`, error);
      }
    }
  }

  if (config['profiles'] && typeof config['profiles'] === 'object') {
    for (const [profileName, profileValue] of Object.entries(config['profiles'] as Record<string, unknown>)) {
      if (!profileValue || typeof profileValue !== 'object' || Array.isArray(profileValue)) continue;

      const profileClone = structuredClone(profileValue) as Record<string, unknown>;
      const { source_overrides: sourceOverrides, ...coreProfile } = profileClone;

      let interpolatedProfile: Record<string, unknown>;
      try {
        interpolatedProfile = interpolateDeep(coreProfile, env, { rootPath: 'profiles.*', tolerant: false }) as Record<string, unknown>;
      } catch (error) {
        pushIssue(`/profiles/${profileName}`, error);
        interpolatedProfile = coreProfile;
      }

      if (sourceOverrides !== undefined) {
        interpolatedProfile['source_overrides'] = sourceOverrides;
      }
      (config['profiles'] as Record<string, unknown>)[profileName] = interpolatedProfile;

      if (!sourceOverrides || typeof sourceOverrides !== 'object' || Array.isArray(sourceOverrides)) continue;

      for (const [sourceId, sourceOverride] of Object.entries(sourceOverrides as Record<string, unknown>)) {
        if (!sourceOverride || typeof sourceOverride !== 'object' || Array.isArray(sourceOverride)) continue;
        try {
          (sourceOverrides as Record<string, unknown>)[sourceId] = interpolateDeep(
            sourceOverride,
            env,
            { rootPath: 'profiles.*.source_overrides.*', tolerant: false },
          );
        } catch (error) {
          pushIssue(`/profiles/${profileName}/source_overrides/${sourceId}`, error);
        }
      }
    }
  }

  return { config, issues };
}

function materializeProfileSourceOverridesForDiff(
  loadResult: LoadResult,
  profileName: string,
): Record<string, unknown> | undefined {
  const rawProfile = loadResult.config?.profiles?.[profileName];
  const rawSourceOverrides = (rawProfile as Record<string, unknown> | undefined)?.['source_overrides'];

  if (!rawSourceOverrides || typeof rawSourceOverrides !== 'object' || Array.isArray(rawSourceOverrides)) {
    return undefined;
  }

  const env = buildResolvedEnv(loadResult);
  const normalizedSourceOverrides = structuredClone(rawSourceOverrides) as Record<string, unknown>;

  for (const [sourceId, sourceOverride] of Object.entries(normalizedSourceOverrides)) {
    if (!sourceOverride || typeof sourceOverride !== 'object' || Array.isArray(sourceOverride)) {
      continue;
    }

    normalizedSourceOverrides[sourceId] = interpolateDeep(
      sourceOverride,
      env,
      { rootPath: 'profiles.*.source_overrides.*' },
    );
  }

  return normalizedSourceOverrides;
}

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      const replacement: Record<string, unknown> = {};
      current[part] = replacement;
      current = replacement;
      continue;
    }

    current = next as Record<string, unknown>;
  }

  const leaf = parts.at(-1);
  if (leaf !== undefined) {
    current[leaf] = value;
  }
}

function parseBooleanScalar(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function coerceScalarValueForDiff(
  value: unknown,
  kind: 'number' | 'boolean' | 'string',
): unknown | undefined {
  if (kind === 'string') {
    return undefined;
  }

  if (kind === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return parseBooleanScalar(value) ?? undefined;
  }

  return undefined;
}

function normalizeYoutubeActiveSourceConfigForDiff(
  value: unknown,
  baseDir: string,
): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const normalized = structuredClone(value) as Record<string, unknown>;
  const scalarCoercions = YouTubeSourceRegistration.metadata?.scalarCoercions ?? {};
  for (const [path, kind] of Object.entries(scalarCoercions)) {
    const coerced = coerceScalarValueForDiff(deepGet(normalized, path), kind);
    if (coerced !== undefined) {
      deepSet(normalized, path, coerced);
    }
  }

  return resolveRawYoutubeActiveSourceConfigPaths(normalized, baseDir);
}

function normalizeYoutubeSourceOverridesForDiff(
  value: unknown,
  baseDir: string,
): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const normalized = structuredClone(value) as Record<string, unknown>;
  const sourceOverride = normalized[YouTubeSourceRegistration.sourceId];
  if (sourceOverride !== undefined) {
    normalized[YouTubeSourceRegistration.sourceId] = normalizeYoutubeActiveSourceConfigForDiff(
      sourceOverride,
      baseDir,
    );
  }

  return normalized;
}


export function ensureNoSource(options: CliOptions, commandName: string): boolean {
  if (optionString(options, 'source')) {
    console.error(`--source is not applicable to 'config ${commandName}'.`);
    return false;
  }
  return true;
}

function hasSourceScopedCliOverrides(cliOverrides: Partial<Profile>): boolean {
  return Object.keys(cliOverrides.source_overrides ?? {}).length > 0;
}

/**
 * Dispatcher for `aidha-youtube config <subcommand>`
 */
export async function runConfig(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult,
  resolvedConfig?: ResolvedConfig,
  error?: Error
): Promise<number> {
  const subcommand = positionals[0];

  switch (subcommand) {
    case 'path':
      return runConfigPath(options, loadResult);
    case 'validate':
      return runConfigValidate(options, loadResult, resolvedConfig, error);
    case 'list-profiles':
      return runConfigListProfiles(options, loadResult, error);
    case 'show':
      if (!resolvedConfig) return printConfigLoadError(error);
      return runConfigShow(options, loadResult, resolvedConfig);
    case 'get':
      if (!resolvedConfig) return printConfigLoadError(error);
      return runConfigGet(positionals, options, loadResult, resolvedConfig);
    case 'explain':
      if (!resolvedConfig) return printConfigLoadError(error);
      return runConfigExplain(positionals, options, loadResult, resolvedConfig);
    case 'init':
      return runConfigInit(options);
    case 'set':
      if (!ensureNoSource(options, 'set')) return 2;
      return runConfigSet(positionals, options, loadResult);
    case 'diff':
      return runConfigDiff(positionals, options, loadResult, error);
    default:
      console.error(`Unknown config subcommand: ${subcommand}`);
      console.error('Available: path, validate, list-profiles, show, get, explain, init, set, diff');
      return 1;
  }
}

function printConfigLoadError(error?: Error): number {
  if (error) {
    console.error(`Error: Failed to load configuration.`);
    console.error(`Reason: ${error.message}`);
    if (error instanceof ConfigValidationError) {
      for (const e of error.errors) {
        console.error(`- ${e.path}: ${e.message}`);
      }
    }
    return 1;
  }
  console.error('Error: This command requires a valid configuration.');
  return 1;
}


async function runConfigExplain(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult,
  resolvedConfig: ResolvedConfig
): Promise<number> {

  const key = positionals[1];
  if (!key) {
    console.error('Usage: config explain <key> [--source <id>]');
    return 1;
  }


  const val = deepGet(resolvedConfig, key);
  if (val === undefined) {
    console.error(`Key not found: ${key}`);
    return 1;
  }

  const explicitProfile = optionString(options, 'profile');
  const sourceId = optionString(options, 'source');
  const { value, provenance } = resolveKeyProvenance({
    key,
    rawConfig: loadResult.config,
    resolvedConfig,
    cliOverrides: buildCliOverrides(options),
    profileName: explicitProfile,
    sourceId,
    sourceRegistrations: [YouTubeSourceRegistration],
  });

  // Format provenance for the specific key
  const output = formatProvenance(provenance, value, [YouTubeSourceRegistration]);
  console.log(output);
  return 0;
}

function runConfigPath(options: CliOptions, loadResult: LoadResult): number {
  if (!ensureNoSource(options, 'path')) return 2;

  if (optionBool(options, 'base-dir')) {
    console.log(resolve(loadResult.baseDir));
    return 0;
  }

  if (loadResult.configPath) {
    console.log(resolve(loadResult.configPath));
  } else {
    console.log('none');
  }
  return 0;
}

function runConfigValidate(
  options: CliOptions,
  loadResult: LoadResult,
  _resolvedConfig?: ResolvedConfig,
  error?: Error,
): number {
  if (!ensureNoSource(options, 'validate')) return 2;

  if (error) {
    // Use centralized error printer
    return printConfigLoadError(error);
  }

  if (!loadResult.config) {
    if (loadResult.configPath) {
      console.error(`Config file exists but loaded as null: ${loadResult.configPath}`);
      return 1;
    }
    console.log('No config file loaded (using internal defaults).');
    return 0;
  }

  const prepared = prepareConfigForValidation(loadResult);
  const result = validateConfig(prepared.config ?? loadResult.config, [YouTubeSourceRegistration]);
  const issues = [...result.errors.map((validationError) => ({
    path: validationError.path,
    message: validationError.message,
  })), ...prepared.issues];

  if (issues.length > 0) {
    const pathStr = loadResult.configPath ? resolve(loadResult.configPath) : '(unknown file)';
    console.error(`Config is invalid: ${pathStr}`);
    for (const validationError of issues) {
      console.error(`- ${validationError.path}: ${validationError.message}`);
    }
    return 1;
  }

  console.log(`Config is valid: ${resolve(loadResult.configPath ?? '')}`);
  return 0;
}

function runConfigListProfiles(options: CliOptions, loadResult: LoadResult, error?: Error): number {
  if (!ensureNoSource(options, 'list-profiles')) return 2;

  if (error) {
    return printConfigLoadError(error);
  }

  const profiles = new Set<string>();

  if (loadResult.config?.profiles) {
    for (const name of Object.keys(loadResult.config.profiles)) {
      profiles.add(name);
    }
  }

  const sorted = Array.from(profiles).sort();
  if (optionBool(options, 'json')) {
    console.log(JSON.stringify(sorted, null, 2));
    return 0;
  }

  if (sorted.length === 0) {
    console.log('(no profiles defined)');
  } else {
    for (const name of sorted) {
      console.log(name);
    }
  }
  return 0;
}

// ── Increment 2: Inspection (show, get, explain) ─────────────────────────────

async function confirmAction(message: string, force: boolean): Promise<boolean> {
  if (force) return true;
  if (!process.stdout.isTTY) return false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function runConfigShow(
  options: CliOptions,
  loadResult: LoadResult,
  defaultResolved: ResolvedConfig
): Promise<number> {
  if (!ensureNoSource(options, 'show')) return 2;

  const showSecrets = optionBool(options, 'show-secrets');
  const raw = optionBool(options, 'raw');
  const force = optionBool(options, 'yes');

  if (raw) {
    if (process.stdout.isTTY) {
      const confirmed = await confirmAction('⚠️  Warning: Printing raw config file may expose secrets. Continue?', force);
      if (!confirmed) {
        console.error('Aborted.');
        return 1;
      }
    } else if (!force) {
      console.error('Error: --raw in non-TTY requires --yes to confirm security risk.');
      return 1;
    }

    if (!loadResult.configPath) {
      console.error('No config file found.');
      return 1;
    }

    try {
      const content = await readFile(loadResult.configPath, 'utf-8');
      console.log(content);
      return 0;
    } catch (err) {
      console.error(`Failed to read config file: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (showSecrets) {
    if (process.stdout.isTTY) {
      const confirmed = await confirmAction('⚠️  Warning: --show-secrets will expose sensitive data. Continue?', force);
      if (!confirmed) {
        console.error('Aborted.');
        return 1;
      }
    } else if (!force) {
      console.error('Error: --show-secrets in non-TTY requires --yes to confirm security risk.');
      return 1;
    }
  }

  const configToPrint = showSecrets
    ? defaultResolved
    : redactResolvedConfigForDisplay(defaultResolved);

  if (optionBool(options, 'json')) {
    console.log(JSON.stringify(configToPrint, null, 2));
  } else {
    console.log(dumpYaml(configToPrint));
  }
  return 0;
}

async function runConfigGet(
  positionals: string[],
  options: CliOptions,
  _loadResult: LoadResult,
  resolvedConfig: ResolvedConfig
): Promise<number> {
  const key = positionals[1];
  if (!key) {
    console.error('Usage: config get <key>');
    return 1;
  }

  const val = deepGet(resolvedConfig, key);

  if (val === undefined) {
    console.error(`Key not found: ${key}`);
    return 1;
  }

  const keyLeaf = key.split('.').at(-1) ?? key;
  const showSecrets = optionBool(options, 'show-secrets');
  const force = optionBool(options, 'yes');

  const containsSecretDescendants = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(item => containsSecretDescendants(item));
    for (const [prop, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(prop)) return true;
      if (containsSecretDescendants(nested)) return true;
    }
    return false;
  };

  const keyIsSecret = isSecretKey(key) || isSecretKey(keyLeaf);
  const valueHasSecrets = keyIsSecret ? true : containsSecretDescendants(val);

  if (showSecrets && valueHasSecrets) {
    if (process.stdout.isTTY) {
      const confirmed = await confirmAction('⚠️  Warning: --show-secrets will expose sensitive data. Continue?', force);
      if (!confirmed) {
        console.error('Aborted.');
        return 1;
      }
    } else if (!force) {
      console.error('Error: --show-secrets in non-TTY requires --yes to confirm security risk.');
      return 1;
    }
  }

  let outputValue: unknown = val;
  if (!showSecrets) {
    if (keyIsSecret) {
      outputValue = REDACTED;
    } else if (typeof val === 'object' && val !== null) {
      outputValue = redactSecrets(val);
    }
  }

  if (typeof outputValue === 'object' && outputValue !== null) {
    if (optionBool(options, 'json')) {
      console.log(JSON.stringify(outputValue, null, 2));
    } else {
      console.log(dumpYaml(outputValue));
    }
  } else {
    console.log(String(outputValue));
  }
  return 0;
}

// ── Increment 3: Scaffolding (init) ──────────────────────────────────────────


const BASE_SCAFFOLD = `# AIDHA Configuration File
config_version: 1

# Default profile to use when --profile is not specified
default_profile: local

profiles:
  local:
    # Local development profile
    llm:
      model: gpt-4o

    # Add source-specific overrides here.
    # source_overrides:
    #   youtube:
    #     youtube:
    #       cookie: \${YOUTUBE_COOKIE:-}
`;

const SOURCE_SCAFFOLDS: Record<string, string> = {
  youtube: `    source_overrides:
      youtube:
        youtube:
          cookie: \${YOUTUBE_COOKIE:-}
`,
};


async function runConfigInit(options: CliOptions): Promise<number> {
  // Parsing source is allowed for init options.


  const force = optionBool(options, 'force');
  const dryRun = optionBool(options, 'dry-run');
  const interactive = optionBool(options, 'interactive');

  let targetPath: string;
  if (optionBool(options, 'user-global')) {
    const xdgConfigHome = process.env['XDG_CONFIG_HOME'];
    const xdgConfigHomeTrimmed = xdgConfigHome?.trim();
    const configHome =
      xdgConfigHomeTrimmed && xdgConfigHomeTrimmed.length > 0 && isAbsolute(xdgConfigHomeTrimmed)
        ? xdgConfigHomeTrimmed
        : join(homedir(), '.config');
    targetPath = join(configHome, 'aidha', 'config.yaml');
  } else {
    targetPath = resolve(process.cwd(), '.aidha', 'config.yaml');
  }

  if (interactive) {
    if (!process.stdout.isTTY) {
      console.warn('⚠️  Warning: Interactive initialization running in non-interactive environment.');
      console.warn('   Falling back to default scaffold.');
    } else {
      console.log('Interactive setup not yet implemented. Using default scaffold.');
    }
  }


  const sourceOpt = optionString(options, 'source');
  let scaffold = BASE_SCAFFOLD;

  if (sourceOpt) {
    if (SOURCE_SCAFFOLDS[sourceOpt]) {
      scaffold += '\n' + SOURCE_SCAFFOLDS[sourceOpt];
    } else {
      console.warn(`⚠️  Warning: No scaffold defined for source '${sourceOpt}'.`);
    }
  } else {
    scaffold += `
# Add source configs here
# sources:
#   youtube:
#     youtube:
#       cookie: \${YOUTUBE_COOKIE:-}
`;
  }

  const content = scaffold;

  if (dryRun) {
    console.log(`Dry run: Would write to ${targetPath}`);
    console.log('--- Content ---');
    console.log(content);
    return 0;
  }

  let alreadyExists = false;
  try {
    await stat(targetPath);
    alreadyExists = true;
  } catch {
    // file not present
  }

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, { mode: 0o600, encoding: 'utf-8', flag: force ? 'w' : 'wx' });
    try {
      await chmod(targetPath, 0o600);
    } catch {
      // chmod may fail on some filesystems; continue
    }
    if (alreadyExists && force) {
      console.log(`Overwriting existing config at ${targetPath}`);
    }
    console.log(`Initialized config at ${targetPath}`);
    return 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      console.error(`Error: Config file already exists at ${targetPath}`);
      console.error('       Use --force to overwrite.');
      return 1;
    }
    console.error(`Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function runConfigSet(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult
): Promise<number> {
  const key = positionals[1];
  const value = positionals[2];

  if (!key || value === undefined) {
    console.error('Usage: config set <key> <value> [--config <path>]');
    return 1;
  }

  const dryRun = optionBool(options, 'dry-run');

  // Determine target path:
  // 1. Explicit --config
  // 2. loadResult.configPath (if auto-discovered)
  // 3. Fallback to .aidha/config.yaml in CWD
  let targetPath = optionString(options, 'config');
  if (!targetPath) {
    targetPath = loadResult.configPath || resolve(process.cwd(), '.aidha', 'config.yaml');
  }

  try {
    const result = mutateConfig({
      filePath: targetPath,
      keyPath: key,
      value,
      dryRun,
      sourceRegistrations: [YouTubeSourceRegistration],
      env: buildResolvedEnv(loadResult),
    });

    if (result.written) {
      console.log(`Successfully updated ${key} in ${targetPath}`);
      if (result.backupPath) {
        console.log(`Backup created at: ${result.backupPath}`);
      }
    } else if (dryRun) {
      if (result.validationErrors && result.validationErrors.length > 0) {
        console.error('Error: Configuration validation failed.');
        for (const error of result.validationErrors) {
          console.error(`- ${error.path}: ${error.message}`);
        }
        return 1;
      }
      console.log(`Dry run: Would update ${key} in ${targetPath}`);
    } else {
      if (result.validationErrors && result.validationErrors.length > 0) {
        console.error('Error: Configuration validation failed.');
        for (const error of result.validationErrors) {
          console.error(`- ${error.path}: ${error.message}`);
        }
        return 1;
      }
      console.error(`No changes were written to ${targetPath} for ${key}.`);
      return 1;
    }

    return 0;
  } catch (err) {
    if (err instanceof ConfigWriteValidationError) {
      console.error('Error: Configuration validation failed.');
      console.error(err.message);
      return 1;
    }
    console.error(`Error: Failed to update configuration: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function runConfigDiff(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult,
  error?: Error,
): Promise<number> {
  if (error) return printConfigLoadError(error);

  const profileA = positionals[1];
  const profileB = positionals[2];

  if (!profileA || !profileB) {
    console.error('Usage: config diff <profileA> <profileB>');
    return 1;
  }

  const sourceId = optionString(options, 'source');
  const cliOverrides = buildCliOverrides(options);
  const knownProfiles = loadResult.config?.profiles ?? {};
  const requestedProfiles = [profileA, profileB];
  const missingProfiles = [
    ...new Set(requestedProfiles.filter((name) => name !== 'default' && !Object.hasOwn(knownProfiles, name))),
  ];

  if (missingProfiles.length > 0) {
    console.error(`Error: Unknown profile name(s): ${missingProfiles.join(', ')}.`);
    return 1;
  }

  if (hasSourceScopedCliOverrides(cliOverrides)) {
    console.error('config diff does not support source-scoped CLI overrides. Remove any --ytdlp-* flags.');
    return 2;
  }

  const resolveProfile = (name: string) => resolveConfig({
    profileName: name,
    sourceId,
    rawConfig: loadResult.config,
    defaults: DEFAULTS,
    baseDir: loadResult.baseDir,
    cliOverrides,
    sourceRegistrations: [YouTubeSourceRegistration],
    env: buildResolvedEnv(loadResult),
  });

  try {
    const configA = resolveProfile(profileA);
    const configB = resolveProfile(profileB);

    if (sourceId && configA.activeSourceConfig !== undefined) {
      configA.activeSourceConfig = normalizeYoutubeActiveSourceConfigForDiff(
        configA.activeSourceConfig,
        configA.baseDir,
      );
    }
    if (sourceId && configB.activeSourceConfig !== undefined) {
      configB.activeSourceConfig = normalizeYoutubeActiveSourceConfigForDiff(
        configB.activeSourceConfig,
        configB.baseDir,
      );
    }

    if (!sourceId && configA.activeSourceConfig === undefined) {
      const sourceOverrides = materializeProfileSourceOverridesForDiff(loadResult, profileA);
      if (sourceOverrides !== undefined) {
        configA.activeSourceConfig = normalizeYoutubeSourceOverridesForDiff(sourceOverrides, configA.baseDir);
      }
    }
    if (!sourceId && configB.activeSourceConfig === undefined) {
      const sourceOverrides = materializeProfileSourceOverridesForDiff(loadResult, profileB);
      if (sourceOverrides !== undefined) {
        configB.activeSourceConfig = normalizeYoutubeSourceOverridesForDiff(sourceOverrides, configB.baseDir);
      }
    }

    const showSecrets = optionBool(options, 'show-secrets');
    const force = optionBool(options, 'yes');

    if (showSecrets) {
      if (process.stdout.isTTY) {
        const confirmed = await confirmAction('⚠️  Warning: --show-secrets will expose sensitive data. Continue?', force);
        if (!confirmed) {
          console.error('Aborted.');
          return 1;
        }
      } else if (!force) {
        console.error('Error: --show-secrets in non-TTY requires --yes to confirm security risk.');
        return 1;
      }
    }

    // Compare the resolved configs first so secret-only changes remain visible.
    const diff = computeDiff(configA, configB);
    const displayDiff = showSecrets ? diff : redactDiffForDisplay(diff);

    if (optionBool(options, 'json')) {
      console.log(JSON.stringify(displayDiff, null, 2));
    } else if (Object.keys(diff).length === 0) {
      console.log(`Profiles '${profileA}' and '${profileB}' are identical.`);
    } else {
      console.log(dumpYaml(displayDiff));
    }
    return 0;
  } catch (err) {
    console.error(`Error calculating diff: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function computeDiff(a: object | undefined, b: object | undefined, path = ''): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  const recordA = a as Record<string, unknown> | undefined;
  const recordB = b as Record<string, unknown> | undefined;
  const allKeys = new Set([...Object.keys(recordA || {}), ...Object.keys(recordB || {})]);

  for (const key of allKeys) {
    const valA = recordA?.[key];
    const valB = recordB?.[key];

    if (isDeepStrictEqual(valA, valB)) continue;

    if (typeof valA === 'object' && typeof valB === 'object' && valA !== null && valB !== null && !Array.isArray(valA) && !Array.isArray(valB)) {
      const nestedDiff = computeDiff(valA, valB, path ? `${path}.${key}` : key);
      if (Object.keys(nestedDiff).length > 0) {
        diff[key] = nestedDiff;
      }
    } else {
      diff[key] = {
        from: valA,
        to: valB
      };
    }
  }

  return diff;
}
