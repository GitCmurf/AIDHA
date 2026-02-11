/**
 * Config bridge — connects @aidha/config to the praecis CLI.
 *
 * Provides `resolveCliConfig()` which runs the full config loading pipeline
 * (file discovery → YAML parse → dotenv → interpolation → schema validation →
 * path resolution) and then applies the five-tier resolver.
 *
 * The result is a typed `ResolvedConfig` ready for use by command handlers.
 *
 * @module
 */
import type {
  ResolvedConfig,
  Profile,
  LoadResult,
} from '@aidha/config';
import {
  loadConfig,
  resolveConfig,
} from '@aidha/config';

// ── Public Types ─────────────────────────────────────────────────────────────

export interface ConfigBridgeOptions {
  /** Explicit config file path (--config flag). */
  configPath?: string;
  /** Named profile to activate (--profile flag). */
  profile?: string;
  /** Ingestion source ID (--source flag). */
  source?: string;
  /** CLI flag overrides (Tier 1, e.g., --model, --db). */
  cliOverrides?: Partial<Profile>;
}

export interface ConfigBridgeResult {
  /** The fully-resolved config. */
  config: ResolvedConfig;
  /** Loader result — includes warnings and the config file path used. */
  loadResult: LoadResult;
}

// ── Bridge ───────────────────────────────────────────────────────────────────

/**
 * Load and resolve the AIDHA configuration for the CLI.
 *
 * 1. Discover and parse the config file (or use defaults if none found).
 * 2. Resolve through all five tiers: CLI → profile → source → default → DEFAULTS.
 * 3. Return the `ResolvedConfig` ready for consumption.
 *
 * In zero-config mode (no config file), only Tiers 1 and 5 contribute.
 */
export async function resolveCliConfig(
  opts: ConfigBridgeOptions = {},
): Promise<ConfigBridgeResult> {
  const loadResult = await loadConfig({
    configPath: opts.configPath || undefined,
    onWarning: (msg) => {
      // eslint-disable-next-line no-console
      console.warn(`[config] ${msg}`);
    },
  });

  const config = resolveConfig({
    rawConfig: loadResult.config,
    baseDir: loadResult.baseDir,
    profileName: opts.profile || undefined,
    sourceId: opts.source || undefined,
    cliOverrides: opts.cliOverrides,
  });

  return { config, loadResult };
}

// ── CLI Override Helpers ─────────────────────────────────────────────────────

type CliOptions = Record<string, string | boolean>;

/**
 * Helper to read a string CLI option.
 * Returns `undefined` if the option is absent or empty.
 */
function optStr(options: CliOptions, key: string): string | undefined {
  const v = options[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Helper to read a numeric CLI option.
 * Returns `undefined` if the option is absent or not a valid integer.
 */
function optNum(options: CliOptions, key: string): number | undefined {
  const v = options[key];
  if (typeof v !== 'string') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Helper to read a boolean CLI option.
 */
function optBool(options: CliOptions, key: string): boolean | undefined {
  return options[key] === true ? true : undefined;
}

/**
 * Build a `Partial<Profile>` from CLI flags that override config values.
 * Only keys that are explicitly set on the command line are included.
 */
export function buildCliOverrides(options: CliOptions): Partial<Profile> {
  const overrides: Partial<Profile> = {};

  // ── db ──
  const db = optStr(options, 'db');
  if (db !== undefined) overrides.db = db;

  // ── llm ──
  const model = optStr(options, 'model');
  if (model !== undefined) {
    overrides.llm = { ...(overrides.llm ?? {}), model };
  }

  // ── editor ──
  const editorVersion = optStr(options, 'editor-version');
  if (editorVersion !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), version: editorVersion.toLowerCase() };
  }
  const windowMinutes = optNum(options, 'window-minutes');
  if (windowMinutes !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), window_minutes: windowMinutes };
  }
  const maxPerWindow = optNum(options, 'max-per-window');
  if (maxPerWindow !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), max_per_window: maxPerWindow };
  }
  const minWindows = optNum(options, 'min-windows');
  if (minWindows !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), min_windows: minWindows };
  }
  const minWords = optNum(options, 'min-words');
  if (minWords !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), min_words: minWords };
  }
  const minChars = optNum(options, 'min-chars');
  if (minChars !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), min_chars: minChars };
  }
  const editorLlm = optBool(options, 'editor-llm');
  if (editorLlm !== undefined) {
    overrides.editor = { ...(overrides.editor ?? {}), editor_llm: editorLlm };
  }

  // ── extraction ──
  const maxClaims = optNum(options, 'claims');
  if (maxClaims !== undefined) {
    overrides.extraction = { ...(overrides.extraction ?? {}), max_claims: maxClaims };
  }
  const chunkMinutes = optNum(options, 'chunk-minutes');
  if (chunkMinutes !== undefined) {
    overrides.extraction = { ...(overrides.extraction ?? {}), chunk_minutes: chunkMinutes };
  }
  const maxChunks = optNum(options, 'max-chunks');
  if (maxChunks !== undefined) {
    overrides.extraction = { ...(overrides.extraction ?? {}), max_chunks: maxChunks };
  }
  const promptVersion = optStr(options, 'prompt-version');
  if (promptVersion !== undefined) {
    overrides.extraction = { ...(overrides.extraction ?? {}), prompt_version: promptVersion };
  }

  // ── export ──
  const sourcePrefix = optStr(options, 'source-prefix');
  if (sourcePrefix !== undefined) {
    overrides.export = { ...(overrides.export ?? {}), source_prefix: sourcePrefix.trim().toLowerCase() };
  }

  // ── ytdlp ──
  const ytdlpBin = optStr(options, 'ytdlp-bin');
  if (ytdlpBin !== undefined) {
    overrides.ytdlp = { ...(overrides.ytdlp ?? {}), bin: ytdlpBin };
  }
  const ytdlpCookies = optStr(options, 'ytdlp-cookies');
  if (ytdlpCookies !== undefined) {
    overrides.ytdlp = { ...(overrides.ytdlp ?? {}), cookies_file: ytdlpCookies };
  }
  const ytdlpTimeout = optNum(options, 'ytdlp-timeout');
  if (ytdlpTimeout !== undefined) {
    overrides.ytdlp = { ...(overrides.ytdlp ?? {}), timeout_ms: ytdlpTimeout };
  }
  const ytdlpJsRuntimes = optStr(options, 'ytdlp-js-runtimes');
  if (ytdlpJsRuntimes !== undefined) {
    overrides.ytdlp = { ...(overrides.ytdlp ?? {}), js_runtimes: ytdlpJsRuntimes };
  }
  const ytdlpKeep = optBool(options, 'ytdlp-keep');
  if (ytdlpKeep !== undefined) {
    overrides.ytdlp = { ...(overrides.ytdlp ?? {}), keep_files: ytdlpKeep };
  }

  // ── cache-dir (maps to llm.cache_dir) ──
  const cacheDir = optStr(options, 'cache-dir');
  if (cacheDir !== undefined) {
    overrides.llm = { ...(overrides.llm ?? {}), cache_dir: cacheDir };
  }

  return overrides;
}
