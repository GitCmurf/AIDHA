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

/**
 * Validate a parsed config object against the AIDHA config JSON schema.
 *
 * @param config - The raw parsed config object (e.g., from YAML.parse).
 * @returns A `ValidationResult` with `valid: true` if the config is valid,
 *   or `valid: false` with an array of structured errors.
 */
export function validateConfig(config: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(config);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors ?? []).map(
    (err: ErrorObject) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      keyword: err.keyword,
    }),
  );

  return { valid: false, errors };
}

/**
 * Convert a string value to the type expected by the schema for a given keyPath.
 *
 * @param keyPath - Dot-separated key path (e.g., 'profiles.local.llm.timeout_ms').
 * @param value - The string value from CLI.
 * @returns The converted value (e.g., number, boolean, or string).
 */
export function convertValue(keyPath: string, value: string): any {
  const schema = loadSchema();
  const parts = keyPath.split('.');

  let current: any = schema;

  for (const part of parts) {
    if (!current) break;

    if (current.$ref) {
      const refPath = current.$ref.replace('#/', '').split('/');
      let ref: any = schema;
      for (const refPart of refPath) {
        if (refPart === '$defs') ref = ref.$defs;
        else ref = ref[refPart];
      }
      current = ref;
    }

    if (current.oneOf || current.anyOf) {
        // Union type encountered; unpredictable structure. Treat as unknown.
        current = undefined;
        break;
    }


    if (current.type === 'object') {
      if (current.properties && current.properties[part]) {
        current = current.properties[part];
      } else if (current.additionalProperties) {
        // If current.additionalProperties === true, the type is unknown/any.
        // We should skip conversion (treat as string).
        if (typeof current.additionalProperties === 'object') {
           current = current.additionalProperties;
        } else {
           // boolean true -> any type.
           current = undefined;
        }
      } else {
        current = undefined;
      }
    } else {
      current = undefined;
    }
  }

  // Resolve final ref if any
  if (current && current.$ref) {
    const refPath = current.$ref.replace('#/', '').split('/');
    let ref: any = schema;
    for (const refPart of refPath) {
      if (refPart === '$defs') ref = ref.$defs;
      else ref = ref[refPart];
    }
    current = ref;
  }

  if (current && (current.oneOf || current.anyOf)) {
      return value;
  }

  const expectedType = current?.type;

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
