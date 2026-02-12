import {
  loadConfig,
  validateConfig,
  formatProvenance,
  createProvenance,
  DEFAULTS,
  redactSecrets,
} from '@aidha/config';
import type { LoadResult, ResolvedConfig } from '@aidha/config';
import { resolve, dirname, join } from 'node:path';
import type { CliOptions } from '../cli.js'; // Import CliOptions
import { readFile, writeFile, mkdir, constants, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dump as dumpYaml } from 'js-yaml'; // Restore dumpYaml
import { buildCliOverrides } from './config-bridge.js'; // Restore buildCliOverrides

// ... (rest of imports will be handled by context or subsequent chunks if needed,
// but here I am replacing the block I broke)

// Function to check if a key exists in an object (deep)
function deepHas(obj: any, path: string): boolean {
  const value = deepGet(obj, path);
  return value !== undefined;
}

async function runConfigExplain(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult,
  resolvedConfig: ResolvedConfig
): Promise<number> {
  const key = positionals[2];
  if (!key) {
    console.error('Usage: config explain <key> [--source <id>]');
    return 1;
  }



  if (!loadResult.config) {
    console.error('No config loaded.');
    return 1;
  }

  const profileName = optionString(options, 'profile') || loadResult.config.default_profile || 'default';
  const sourceId = optionString(options, 'source');
  const cliOverrides = buildCliOverrides(options); // Tier 1

  // Tier overrides checking order:
  // 1. CLI Overrides
  // 2. Named Profile
  // 3. Source Defaults
  // 4. Default Profile
  // 5. Hardcoded Defaults

  let tier: import('@aidha/config').ConfigTier;
  let origin = '';

  // 1. CLI
  if (deepHas(cliOverrides, key)) {
    tier = 'cli';
  }
  // 2. Profile
  else if (deepHas(loadResult.config.profiles?.[profileName], key)) {
    tier = 'profile';
  }
  // 3. Source
  else if (sourceId && deepHas(loadResult.config.sources?.[sourceId], key)) {
    tier = 'source';
  }
  // 4. Default Profile (if profileName != default check default too?
  //    Actually resolution logic merges default profile first.
  //    But if profileName IS default, we already checked it in step 2.
  //    If profileName is NOT default, we need to check default profile as fallback.)
  else if (profileName !== 'default' && deepHas(loadResult.config.profiles?.['default'], key)) {
    tier = 'default';
  }
  // 5. Hardcoded
  else {
    // We assume it comes from hardcoded defaults if it exists in resolved config
    // or if we find it in DEFAULTS.
    // DEFAULTS structure matches Config?
    // DEFAULTS.profiles.default, DEFAULTS.sources...
    // Let's check DEFAULTS.profiles.default
    if (deepHas(DEFAULTS.profiles?.['default'], key)) {
      tier = 'hardcoded';
    }
    else if (sourceId && deepHas(DEFAULTS.sources?.[sourceId], key)) {
      tier = 'hardcoded';
    }
    else {
      // Not found or undefined?
      tier = 'hardcoded'; // Fallback
    }
  }

  const provenance = createProvenance(key, tier, {
    profileName,
    sourceId,
  });

  const value = deepGet(resolvedConfig, key);

  // Format provenance for the specific key
  const output = formatProvenance(provenance, value);
  console.log(output);
  return 0;
}


// 'lodash' is not in package.json? I should check.
// If not, I can implement simple deep get or add lodash.get.
// aidha-config uses deepMerge, maybe it helps? No.
// I'll implement a simple deep get for now to avoid dependency if possible, or check package.json.
// Actually, I can use a helper.

function deepGet(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function optionString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

/**
 * Dispatcher for `aidha-youtube config <subcommand>`
 */
export async function runConfig(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult,
  resolvedConfig: ResolvedConfig
): Promise<number> {
  const subcommand = positionals[0];

  switch (subcommand) {
    case 'path':
      return runConfigPath(options, loadResult);
    case 'validate':
      return runConfigValidate(options, loadResult);
    case 'list-profiles':
      return runConfigListProfiles(options, loadResult);
    case 'show':
      return runConfigShow(options, loadResult, resolvedConfig);
    case 'get':
      return runConfigGet(positionals, options, loadResult, resolvedConfig);
    case 'explain':
      return runConfigExplain(positionals, options, loadResult, resolvedConfig);
    case 'init':
      return runConfigInit(options);
    case 'set':
      console.error("Command 'set' is coming in Phase 2B (blocked on AST writer).");
      return 1;
    default:
      console.error(`Unknown config subcommand: ${subcommand}`);
      console.error('Available: path, validate, list-profiles');
      return 1;
  }
}

function ensureNoSource(options: CliOptions, commandName: string): void {
  if (optionString(options, 'source')) {
    console.error(`--source is not applicable to 'config ${commandName}'.`);
    process.exit(2);
  }
}

function runConfigPath(options: CliOptions, loadResult: LoadResult): number {
  ensureNoSource(options, 'path');

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

function runConfigValidate(options: CliOptions, loadResult: LoadResult): number {
  ensureNoSource(options, 'validate');

  if (!loadResult.config) {
    console.log('No config file loaded (using internal defaults).');
    return 0;
  }

  const result = validateConfig(loadResult.config);
  if (result.valid) {
    console.log(`Config is valid: ${resolve(loadResult.configPath ?? '')}`);
    return 0;
  } else {
    console.error(`Config is invalid: ${resolve(loadResult.configPath ?? '')}`);
    for (const error of result.errors) {
      console.error(`- ${error.path}: ${error.message}`);
    }
    return 1;
  }
}

function runConfigListProfiles(options: CliOptions, loadResult: LoadResult): number {
  ensureNoSource(options, 'list-profiles');

  const profiles = new Set<string>();
  // default profile is always implicitly available in effective config,
  // but we are listing DEFINED profiles in the loaded config.
  // The 'default_profile' key in config points to the default active profile.
  // The 'profiles' map contains the definitions.

  if (loadResult.config?.profiles) {
    for (const name of Object.keys(loadResult.config.profiles)) {
      profiles.add(name);
    }
  }

  // Should we include 'default'? If it's a key in profiles, yes.
  // If the user means "what profiles can I pass to --profile?", then yes.

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
  const showSecrets = optionBool(options, 'show-secrets');
  const raw = optionBool(options, 'raw');
  const force = optionBool(options, 'yes');

  if (raw) {
    // D2.4: Raw output requires confirmation
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
    // D2.4: Show secrets requires confirmation
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
    // YAML
    console.log(dumpYaml(configToPrint));
  }
  return 0;
}

function runConfigGet(
  positionals: string[],
  options: CliOptions,
  loadResult: LoadResult,
  resolvedConfig: ResolvedConfig
): number {
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

  if (typeof val === 'object' && val !== null) {
    if (optionBool(options, 'json')) {
      console.log(JSON.stringify(val, null, 2));
    } else {
      console.log(dumpYaml(val));
    }
  } else {
    console.log(String(val));
  }
  return 0;
}



// ── Increment 3: Scaffolding (init) ──────────────────────────────────────────

const DEFAULT_SCAFFOLD = `# AIDHA Configuration File
config_version: 1

# Default profile to use when --profile is not specified
default_profile: local

profiles:
  local:
    # Local development profile
    llm:
      model: gpt-4o
      temperature: 0
    youtube:
      cookie_string: \${YOUTUBE_COOKIE}
`;

async function runConfigInit(options: CliOptions): Promise<number> {
  const force = optionBool(options, 'force');
  const dryRun = optionBool(options, 'dry-run');
  const interactive = optionBool(options, 'interactive');

  // Determine path
  // --user-global -> ~/.config/aidha/config.yaml
  // Default override via --project-local -> ./.aidha/config.yaml
  // We default to project-local as per plan.

  let targetPath: string;
  if (optionBool(options, 'user-global')) {
    targetPath = join(homedir(), '.config', 'aidha', 'config.yaml');
  } else {
    // Project local
    targetPath = resolve(process.cwd(), '.aidha', 'config.yaml');
  }

  if (interactive) {
    if (!process.stdout.isTTY) {
      console.warn('⚠️  Warning: Interactive initialization running in non-interactive environment.');
      console.warn('   Falling back to default scaffold.');
    } else {
      // TODO: Implement interactive flow (ask for model, cookie, etc.)
      // For Increment 3, we focus on deterministic scaffold.
      // If user asks for interactive, we could just print a message saying "interactive coming soon" and proceed?
      // Or implement basic prompts.
      // Plan says "Opt-in guided setup (TTY only)".
      console.log('Interactive setup not yet implemented. Using default scaffold.');
    }
  }

  const content = DEFAULT_SCAFFOLD;

  if (dryRun) {
    console.log(`Dry run: Would write to ${targetPath}`);
    console.log('--- Content ---');
    console.log(content);
    return 0;
  }

  // Check existence
  try {
    await access(targetPath, constants.F_OK);
    // Exists
    if (!force) {
      console.error(`Error: Config file already exists at ${targetPath}`);
      console.error('       Use --force to overwrite.');
      return 1;
    }
    console.log(`Overwriting existing config at ${targetPath}`);
  } catch {
    // Does not exist, proceed
  }

  // Ensure directory
  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, { mode: 0o600, encoding: 'utf-8' });
    console.log(`Initialized config at ${targetPath}`);
    return 0;
  } catch (err) {
    console.error(`Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
