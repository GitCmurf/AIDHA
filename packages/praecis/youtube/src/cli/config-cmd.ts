import {
  validateConfig,
  formatProvenance,
  resolveKeyProvenance,
  redactSecrets,
  isSecretKey,
  REDACTED,
  ConfigValidationError,
  ConfigWriteValidationError,
  mutateConfig,
} from '@aidha/config';
import type { LoadResult, ResolvedConfig } from '@aidha/config';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import type { CliOptions } from '../cli.js'; // Import CliOptions
import { readFile, writeFile, mkdir, constants, access, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dump as dumpYaml } from 'js-yaml'; // Restore dumpYaml
import { buildCliOverrides } from './config-bridge.js'; // Restore buildCliOverrides

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


export function ensureNoSource(options: CliOptions, commandName: string): boolean {
  if (optionString(options, 'source')) {
    console.error(`--source is not applicable to 'config ${commandName}'.`);
    return false;
  }
  return true;
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
      return runConfigValidate(options, loadResult, error);
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
    default:
      console.error(`Unknown config subcommand: ${subcommand}`);
      console.error('Available: path, validate, list-profiles, show, get, explain, init, set');
      return 1;
  }
}

function printConfigLoadError(error?: Error): number {
  if (error) {
    console.error(`Error: Failed to load configuration.`);
    console.error(`Reason: ${error.message}`);
    // Check for nested errors (e.g. schema validation)
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
  });

  // Format provenance for the specific key
  const output = formatProvenance(provenance, value);
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

function runConfigValidate(options: CliOptions, loadResult: LoadResult, error?: Error): number {
  if (!ensureNoSource(options, 'validate')) return 2;


  if (error) {
    // Use centralized error printer
    return printConfigLoadError(error);
  }

  if (!loadResult.config) {
    if (loadResult.configPath) {
        // Should have been caught above if it was an error?
        // Maybe config is null but no error attached? (e.g. file empty?)
        console.error(`Config file exists but loaded as null: ${loadResult.configPath}`);
        return 1;
    }
    console.log('No config file loaded (using internal defaults).');
    return 0;
  }

  const result = validateConfig(loadResult.config);
  if (result.valid) {
    console.log(`Config is valid: ${resolve(loadResult.configPath ?? '')}`);
    return 0;
  } else {
    // Should be unreachable if loader throws on invalid?
    // But maybe loader validates interpolated config?
    // If loader throws, we handled it above.
    const pathStr = loadResult.configPath ? resolve(loadResult.configPath) : '(unknown file)';
    console.error(`Config is invalid: ${pathStr}`);
    for (const error of result.errors) {
      console.error(`- ${error.path}: ${error.message}`);
    }
    return 1;
  }
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

  const configToPrint = showSecrets ? defaultResolved : redactSecrets(defaultResolved);

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
  const secretKey = isSecretKey(key) || isSecretKey(keyLeaf);
  const showSecrets = optionBool(options, 'show-secrets');
  const force = optionBool(options, 'yes');

  if (secretKey && showSecrets) {
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

  const outputValue = secretKey && !showSecrets ? REDACTED : val;

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
`;

const SOURCE_SCAFFOLDS: Record<string, string> = {
  youtube: `sources:
  youtube:
    youtube:
      cookie: \${YOUTUBE_COOKIE}
`,
  rss: `sources:
  rss:
    rss:
      poll_interval_minutes: 60
`
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
  // Default to youtube if no source specified (backward compat/current state) or if strictness desired?
  // User guide implies init with nothing gives basic.
  // But previously we hardcoded youtube. Let's strictly require it or default to none?
  // Current hardcoded had youtube. Let's default to 'youtube' for now to match specific requirement,
  // or better: default to empty unless requested?
  // "Implement `aidha config init --source <id>` scaffolding."

  let scaffold = BASE_SCAFFOLD;

  if (sourceOpt) {
      if (SOURCE_SCAFFOLDS[sourceOpt]) {
          scaffold += '\n' + SOURCE_SCAFFOLDS[sourceOpt];
      } else {
          console.warn(`⚠️  Warning: No scaffold defined for source '${sourceOpt}'.`);
      }
  } else {
      // For backward compatibility with the hardcoded version in previous steps,
      // we could include youtube by default, but cleaner to require flags for new sources.
      // However, to keep "local: ... youtube: ..." structure from before if user doesn't specify,
      // I'll add youtube by default if NO source is specified, OR leave it bare.
      // Let's leave it bare to prove extensibility, but maybe that breaks expectations?
      // "Implement `aidha config init --source <id>` scaffolding" suggests specific opt-in.
      // I'll add a comment in the file to prompt adding sources.
      scaffold += `
# Add source configs here
# sources:
#   youtube:
#     youtube:
#       cookie: \${YOUTUBE_COOKIE}
`;
  }

  const content = scaffold;

  if (dryRun) {
    console.log(`Dry run: Would write to ${targetPath}`);
    console.log('--- Content ---');
    console.log(content);
    return 0;
  }

  try {
    await access(targetPath, constants.F_OK);
    if (!force) {
      console.error(`Error: Config file already exists at ${targetPath}`);
      console.error('       Use --force to overwrite.');
      return 1;
    }
    console.log(`Overwriting existing config at ${targetPath}`);
  } catch {
    // Does not exist, proceed
  }

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, { mode: 0o600, encoding: 'utf-8' });

    try {
      await chmod(targetPath, 0o600);
    } catch (chmodErr) {
       // Ignore chmod error on Windows? Or warn?
       // Just proceed.
    }

    console.log(`Initialized config at ${targetPath}`);
    return 0;
  } catch (err) {
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
