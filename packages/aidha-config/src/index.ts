/**
 * @aidha/config — Centralized configuration management for AIDHA CLI tools.
 *
 * @example
 * ```ts
 * import { loadConfig, resolveConfig, redactSecrets } from '@aidha/config';
 *
 * const { config, baseDir } = await loadConfig();
 * const resolved = resolveConfig({ rawConfig: config, baseDir });
 * console.log(redactSecrets(resolved));
 * ```
 *
 * @module
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  AidhaConfig,
  Profile,
  SourceDefaults,
  LlmConfig,
  EditorConfig,
  ExtractionConfig,
  ExportConfig,
  YtdlpConfig,
  YoutubeConfig,
  EnvConfig,
  ResolvedConfig,
  DeepReadonly,
} from './types.js';

export { SUPPORTED_CONFIG_VERSION } from './types.js';

// ── Defaults ─────────────────────────────────────────────────────────────────
export { DEFAULTS } from './defaults.js';

// ── Schema validation ────────────────────────────────────────────────────────
export { validateConfig, loadSchema } from './schema.js';

// ── Environment variable interpolation ───────────────────────────────────────
export {
  interpolateString,
  interpolateDeep,
  InterpolationCycleError,
  InterpolationDepthError,
  InterpolationObjectCycleError,
  UnsetVariableError,
} from './interpolation.js';

// ── Path resolution ──────────────────────────────────────────────────────────
export {
  computeBaseDirPrelim,
  computeFinalBaseDir,
  resolvePathValue,
  resolvePathValues,
  isBareCommand,
  getPathAnnotatedKeys,
} from './paths.js';

// ── Five-tier resolver ───────────────────────────────────────────────────────
export { resolveConfig, deepMerge } from './resolver.js';
export type { ResolveOptions } from './resolver.js';

// ── Secret redaction ─────────────────────────────────────────────────────────
export { redactSecrets, isSecretKey, REDACTED } from './redact.js';

// ── Provenance / explain ─────────────────────────────────────────────────────
export { createProvenance, formatProvenance, resolveKeyProvenance } from './explain.js';
export type {
  ConfigTier,
  Provenance,
  ProvenanceOptions,
  ResolveKeyProvenanceOptions,
  KeyProvenanceResult,
} from './explain.js';

// ── Config loader ────────────────────────────────────────────────────────────
export {
  loadConfig,
  discoverConfigPath,
  checkFilePermissions,
  ConfigParseError,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigVersionError,
} from './loader.js';
export type { LoadOptions, LoadResult } from './loader.js';

// ── Config writer ────────────────────────────────────────────────────────────
export {
  writeConfig,
  ConfigReadOnlyError,
  ConfigConflictError,
  ConfigWriteValidationError,
} from './writer.js';
export type { WriteOptions, WriteResult } from './writer.js';
