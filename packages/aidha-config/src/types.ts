// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Core type definitions.
 *
 * These types model the on-disk YAML config structure (`AidhaConfig`),
 * individual profiles (`Profile`), source defaults (`SourceDefaults`),
 * and the flattened runtime shape (`ResolvedConfig`) consumed by app code.
 *
 * Source-private fields are NOT modelled here. Source packages own their
 * own config types and narrow `ResolvedConfig.activeSourceConfig` at their
 * package boundary via `SourceRegistration`.
 *
 * @module
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** The config schema version this binary supports. */
export const SUPPORTED_CONFIG_VERSION = 1;

// ── On-Disk Config Shapes ────────────────────────────────────────────────────

/** LLM-related configuration. */
export interface LlmConfig {
  model: string;
  api_key: string;
  base_url: string;
  timeout_ms: number;
  cache_dir: string;
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  verbosity?: 'low' | 'medium' | 'high';
  embedding_batch_size?: number;
  embedding_task_type?: 'SEMANTIC_SIMILARITY' | 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'CLASSIFICATION' | 'CLUSTERING';
  embedding_output_dimensionality?: number;
}

/** Editor tuning parameters. */
export interface EditorConfig {
  version: string;
  window_minutes: number;
  max_per_window: number;
  min_windows: number;
  min_words: number;
  min_chars: number;
  editor_llm: boolean;
}

/** Extraction parameters. */
export interface ExtractionConfig {
  max_claims: number;
  chunk_minutes: number;
  max_chunks: number;
  prompt_version: string;
}

/** Export settings. */
export interface ExportConfig {
  source_prefix: string;
  out_dir: string;
}

/**
 * A profile is a partial set of config overrides.
 * The `default` profile should be complete; named profiles only
 * need to specify the keys they want to override.
 *
 * Source-private overrides live under `source_overrides.<source-id>`
 * so the core profile schema stays strict without knowing source-private fields.
 */
export interface Profile {
  db?: string;
  llm?: Partial<LlmConfig>;
  editor?: Partial<EditorConfig>;
  extraction?: Partial<ExtractionConfig>;
  export?: Partial<ExportConfig>;
  source_overrides?: Record<string, Record<string, unknown>>;
  extensions?: Record<string, unknown>;
}

/**
 * Source defaults provide ingestion-vector-specific configuration
 * that sits between the system-wide default profile and named profiles.
 * Only keys relevant to that source need to appear.
 */
export type SourceDefaults = Record<string, unknown>;

/** Optional dotenv loading configuration. */
export interface EnvConfig {
  dotenv_files?: string[];
  override_existing?: boolean;
  dotenv_required?: boolean;
}

/**
 * The full on-disk YAML config structure.
 * This is what the YAML parser produces before resolution.
 */
export interface AidhaConfig {
  config_version: number;
  base_dir?: string;
  env?: EnvConfig;
  default_profile: string;
  profiles: Record<string, Profile>;
  sources?: Record<string, SourceDefaults>;
  extensions?: Record<string, unknown>;
}

// ── Source Registration ──────────────────────────────────────────────────────

/**
 * Compile-time contract for source package adapters.
 *
 * Each ingestion source (YouTube, RSS, etc.) exports a concrete
 * `SourceRegistration` that the resolver uses to build, validate,
 * and redact the opaque `activeSourceConfig` payload.
 *
 * The core `@aidha/config` package never imports source packages;
 * it receives registrations at resolver time from the CLI bridge.
 */
export interface SourceRegistration<TSourceConfig = unknown> {
  sourceId: string;
  defaults?: Record<string, unknown>;
  schema?: unknown;
  metadata?: {
    pathFields?: readonly string[];
    secretFields?: readonly string[];
    scalarCoercions?: Readonly<Record<string, 'number' | 'boolean' | 'string'>>;
    explainLabels?: Readonly<Record<string, string>>;
  };
  validateActiveSourceConfig(value: unknown): TSourceConfig;
  redactActiveSourceConfig?(value: TSourceConfig): unknown;
  resolveSourcePaths?(value: TSourceConfig, baseDir: string): TSourceConfig;
  cliBindings?: readonly {
    command: string;
    selectsSourceByDefault: boolean;
  }[];
}

// ── Runtime Resolved Shape ───────────────────────────────────────────────────

/**
 * The flattened, fully-resolved core config consumed by application code.
 * All tiers have been merged; all paths resolved; all env vars interpolated.
 * App code reads this without needing to know which tier a value came from.
 *
 * Source-private fields are NOT on this type. Source packages narrow
 * `activeSourceConfig` at their own boundary via `SourceRegistration`.
 */
export interface ResolvedConfig {
  baseDir: string;
  db: string;
  llm: {
    model: string;
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    cacheDir: string;
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    verbosity?: 'low' | 'medium' | 'high';
    embeddingBatchSize: number;
    embeddingTaskType: 'SEMANTIC_SIMILARITY' | 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'CLASSIFICATION' | 'CLUSTERING';
    embeddingOutputDimensionality: number;
  };
  editor: {
    version: string;
    windowMinutes: number;
    maxPerWindow: number;
    minWindows: number;
    minWords: number;
    minChars: number;
    editorLlm: boolean;
  };
  extraction: {
    maxClaims: number;
    chunkMinutes: number;
    maxChunks: number;
    promptVersion: string;
  };
  export: {
    outDir: string;
    sourcePrefix: string;
  };
  activeSourceId?: string;
  activeSourceConfig?: unknown;
  extensions?: {
    global?: Record<string, unknown>;
    source?: Record<string, unknown>;
    profile?: Record<string, unknown>;
  };
}

// ── Writer Types ─────────────────────────────────────────────────────────────

/** Options for writing a config file safely. */
export interface WriteConfigOptions {
  /** How many .bak files to retain (default: 3). */
  maxBackups?: number;
  /** If true, perform a dry-run and return the diff without writing. */
  dryRun?: boolean;
  /** Optional comment header to prepend to the file. */
  header?: string;
  /** If true, allow overwriting even if the file changed since it was read. */
  force?: boolean;
  /** If true, allow writing to a symlink target (not recommended). */
  allowSymlink?: boolean;
}

/** Result of a config write operation. */
export interface WriteResult {
  /** Path to the backup file created (if any). */
  backupPath?: string;
  /** Whether the file was actually modified. */
  modified: boolean;
  /** Human-readable diff (if dryRun). */
  diff?: string;
}

// ── Utility Types ────────────────────────────────────────────────────────────

/** Recursively makes all properties readonly. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
