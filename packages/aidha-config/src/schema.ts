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

function getValidator(): ValidateFunction {
  if (!_validate) {
    try {
      const schemaText = readFileSync(SCHEMA_PATH, 'utf-8');
      const schema = JSON.parse(schemaText) as Record<string, unknown>;
      // `strict: false` allows our custom x-aidha-* annotations without
      // Ajv complaining about unknown keywords.
      const ajv = new AjvClass({ allErrors: true, strict: false });
      _validate = ajv.compile(schema);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err);
      const wrapped = new Error(
        `Failed to load config schema from ${SCHEMA_PATH}: ${msg}`,
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
 * Load and return the raw JSON Schema object.
 * Useful for introspecting `x-aidha-path` and `x-aidha-secret` annotations.
 */
export function loadSchema(): Record<string, unknown> {
  const schemaText = readFileSync(SCHEMA_PATH, 'utf-8');
  return JSON.parse(schemaText) as Record<string, unknown>;
}
