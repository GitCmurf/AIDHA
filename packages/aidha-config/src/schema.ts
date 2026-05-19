// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — JSON Schema validation for config files.
 *
 * Compiles the JSON Schema from `config.schema.json` using Ajv and
 * exposes a `validateConfig` function that returns structured errors.
 *
 * @module
 */

import AjvNamespace from 'ajv';
import type { ValidateFunction, ErrorObject } from 'ajv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceRegistration } from './types.js';
import { COERCION_MAP } from './schema.generated.js';

// Under NodeNext, `import X from 'ajv'` yields the namespace object.
// The constructor lives at `.default`.
const AjvClass = AjvNamespace.default;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema', 'config.schema.json');

/** Compiled Ajv validator (lazy singleton). */
let _validate: ValidateFunction | undefined;
/** Cached raw schema (lazy singleton). */
let _schema: Record<string, unknown> | undefined;

function getValidator(): ValidateFunction {
  if (!_validate) {
    try {
      const schema = loadSchema();
      // `strict: false` allows our custom x-aidha-* annotations without
      // Ajv complaining about unknown keywords.
      const ajv = new AjvClass({ allErrors: true, strict: false });
      _validate = ajv.compile(schema);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err);
      const wrapped = new Error(
        `Failed to compile config schema: ${msg}`,
      );
      (wrapped as any).cause = err;
      throw wrapped;
    }
  }
  return _validate!;
}

/** Result of schema validation. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** A single schema validation error with a human-friendly message. */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

type ValidationIssueLike = {
  path: string;
  message: string;
};

type StructuredValidationError = {
  errors?: ValidationIssueLike[];
  message?: string;
};

function normalizeValidationPath(path: string): string {
  const normalized = path.replace(/^\/+/, '').replace(/\./g, '/');
  return normalized.length > 0 ? `/${normalized}` : '/';
}

function combineValidationPath(context: string, issuePath: string): string {
  const normalizedContext = context.replace(/^\/+/, '').replace(/\/+$/, '');
  const normalizedIssue = issuePath.replace(/^\/+/, '').replace(/\./g, '/');

  if (!normalizedContext) {
    return normalizeValidationPath(normalizedIssue);
  }

  if (!normalizedIssue) {
    return normalizeValidationPath(normalizedContext);
  }

  return normalizeValidationPath(`${normalizedContext}/${normalizedIssue}`);
}

function toValidationErrors(
  error: unknown,
  context: string,
): ValidationError[] {
  const structured = error as StructuredValidationError | null;
  if (structured?.errors && Array.isArray(structured.errors) && structured.errors.length > 0) {
    return structured.errors.map((issue) => ({
      path: combineValidationPath(context, issue.path),
      message: issue.message,
      keyword: 'sourceValidation',
    }));
  }

  const message = error instanceof Error ? error.message : String(error);
  return [{
    path: normalizeValidationPath(context),
    message,
    keyword: 'sourceValidation',
  }];
}

export function validateRegisteredSourcePayload(
  sourceId: string,
  payload: unknown,
  context: string,
  sourceRegistrations: ReadonlyArray<SourceRegistration>,
): ValidationError[] {
  const registration = sourceRegistrations.find((entry) => entry.sourceId === sourceId);
  if (!registration || payload === undefined) {
    return [];
  }

  try {
    registration.validateActiveSourceConfig(payload);
    return [];
  } catch (error) {
    return toValidationErrors(error, context);
  }
}

function validateKnownSourceBlocks(
  config: unknown,
  sourceRegistrations: ReadonlyArray<SourceRegistration>,
): ValidationError[] {
  if (!config || typeof config !== 'object' || sourceRegistrations.length === 0) {
    return [];
  }

  const errors: ValidationError[] = [];
  const rawConfig = config as Record<string, unknown>;
  const sourceIds = new Set(sourceRegistrations.map((entry) => entry.sourceId));

  const sources = rawConfig['sources'];
  if (sources && typeof sources === 'object') {
    for (const [sourceId, payload] of Object.entries(sources as Record<string, unknown>)) {
      if (!sourceIds.has(sourceId)) continue;
      errors.push(...validateRegisteredSourcePayload(
        sourceId,
        payload,
        `sources.${sourceId}`,
        sourceRegistrations,
      ));
    }
  }

  const profiles = rawConfig['profiles'];
  if (profiles && typeof profiles === 'object') {
    for (const [profileName, profileValue] of Object.entries(profiles as Record<string, unknown>)) {
      if (!profileValue || typeof profileValue !== 'object') continue;

      const sourceOverrides = (profileValue as Record<string, unknown>)['source_overrides'];
      if (!sourceOverrides || typeof sourceOverrides !== 'object') continue;

      for (const [sourceId, payload] of Object.entries(sourceOverrides as Record<string, unknown>)) {
        if (!sourceIds.has(sourceId)) continue;
        errors.push(...validateRegisteredSourcePayload(
          sourceId,
          payload,
          `profiles.${profileName}.source_overrides.${sourceId}`,
          sourceRegistrations,
        ));
      }
    }
  }

  return errors;
}

/**
 * Validate a parsed config object against the AIDHA config JSON schema.
 *
 * @param config - The raw parsed config object (e.g., from YAML.parse).
 * @param sourceRegistrations - Optional source registrations used to validate
 *   source-private payloads for known sources.
 * @returns A `ValidationResult` with `valid: true` if the config is valid,
 *   or `valid: false` with an array of structured errors.
 */
const STRUCTURAL_KEYWORDS = new Set(['required', 'additionalProperties']);

function isTopLevelInstancePath(instancePath: string): boolean {
  const normalized = instancePath.replace(/^\/+/, '');
  return normalized.length > 0 && !normalized.includes('/');
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function instancePathToSchemaPath(instancePath: string): string[] {
  return instancePath
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeJsonPointerSegment);
}

function wildcardSchemaPath(instancePath: string): string {
  const segments = instancePathToSchemaPath(instancePath);
  if (segments.length === 0) return '';

  const wildcarded = [...segments];
  if (wildcarded[0] === 'profiles' || wildcarded[0] === 'sources') {
    if (wildcarded.length > 1) {
      wildcarded[1] = '*';
    }
  }

  const sourceOverridesIndex = wildcarded.indexOf('source_overrides');
  if (sourceOverridesIndex !== -1 && wildcarded.length > sourceOverridesIndex + 1) {
    wildcarded[sourceOverridesIndex + 1] = '*';
  }

  return wildcarded.join('.');
}

function shouldDeferTypeError(config: unknown, instancePath: string): boolean {
  const pathSegments = instancePathToSchemaPath(instancePath);
  if (
    pathSegments.length < 2
    || (pathSegments[0] !== 'profiles' && pathSegments[0] !== 'sources')
  ) {
    return false;
  }

  // Profile/source leaf scalars can still be accepted here when they are
  // string placeholders that `interpolateDeep()` will coerce later.
  const schemaPath = wildcardSchemaPath(instancePath);
  if (!(schemaPath in COERCION_MAP)) {
    return false;
  }

  let current: unknown = config;
  for (const segment of pathSegments) {
    if (current === null || typeof current !== 'object') {
      return false;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return false;
      }
      current = current[index];
      continue;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string';
}

function shouldIncludeAjvError(err: ErrorObject, config: unknown): boolean {
  if (STRUCTURAL_KEYWORDS.has(err.keyword)) return true;
  if (err.keyword !== 'type') return false;
  return isTopLevelInstancePath(err.instancePath) || !shouldDeferTypeError(config, err.instancePath);
}

export function validateStructure(config: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(config);
  const errors: ValidationError[] = [];

  if (!valid) {
    for (const err of validate.errors ?? []) {
      if (shouldIncludeAjvError(err, config)) {
        errors.push({
          path: err.instancePath || '/',
          message: err.message ?? 'Unknown validation error',
          keyword: err.keyword,
        });
      }
    }
  }

  if (errors.length === 0) {
    return { valid: true, errors: [] };
  }

  return { valid: false, errors };
}

export function validateConfig(
  config: unknown,
  sourceRegistrations: ReadonlyArray<SourceRegistration> = [],
): ValidationResult {
  const validate = getValidator();
  const valid = validate(config);
  const errors: ValidationError[] = [];

  if (!valid) {
    errors.push(...(validate.errors ?? []).map(
      (err: ErrorObject) => ({
        path: err.instancePath || '/',
        message: err.message ?? 'Unknown validation error',
        keyword: err.keyword,
      }),
    ));
  }

  errors.push(...validateKnownSourceBlocks(config, sourceRegistrations));

  if (errors.length === 0) {
    return { valid: true, errors: [] };
  }

  return { valid: false, errors };
}

/**
 * Convert a string value to the type expected by the schema for a given keyPath.
 *
 * Consumes COERCION_MAP from schema.generated.ts.
 *
 * @param keyPath - Dot-separated key path (e.g., 'profiles.local.llm.timeout_ms').
 * @param value - The string value from CLI.
 * @returns The converted value (e.g., number, boolean, or string).
 */
export function convertValue(keyPath: string, value: string): unknown {
  const parts = keyPath.split('.');
  const normalizedPath = parts.map((p, i) => {
    // Basic heuristics for dynamic keys in COERCION_MAP
    if (parts[0] === 'profiles' && i === 1) return '*';
    if (parts[0] === 'sources' && i === 1) return '*';
    if (parts[0] === 'source_overrides' && i === 1) return '*';
    if (parts[2] === 'source_overrides' && i === 3) return '*';
    return p;
  }).join('.');

  const expectedType = COERCION_MAP[normalizedPath] || COERCION_MAP[keyPath];

  if (expectedType === 'integer' || expectedType === 'number') {
    if (!value || value.trim().length === 0) {
      throw new Error(`Value for ${keyPath} cannot be empty; expected number.`);
    }
    const n = Number(value);
    if (Number.isNaN(n)) {
      throw new Error(`Invalid numeric value for ${keyPath}: "${value}"`);
    }
    if (expectedType === 'integer' && !Number.isInteger(n)) {
      throw new Error(`Invalid integer value for ${keyPath}: "${value}". Expected an integer.`);
    }
    return n;
  }

  if (expectedType === 'boolean') {
    const v = value.toLowerCase().trim();
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
    throw new Error(`Invalid boolean value for ${keyPath}: "${value}". Expected one of: true, false, 1, 0, yes, no, on, off.`);
  }

  return value;
}

/**
 * Load and return the raw JSON Schema object.
 * Useful for introspecting `x-aidha-path` and `x-aidha-secret` annotations.
 */
export function loadSchema(): Record<string, unknown> {
  if (!_schema) {
      const schemaText = readFileSync(SCHEMA_PATH, 'utf-8');
      _schema = JSON.parse(schemaText) as Record<string, unknown>;
  }
  return _schema;
}
