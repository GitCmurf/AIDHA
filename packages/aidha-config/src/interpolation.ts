// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Environment variable interpolation.
 *
 * Expands `${VAR}` and `${VAR:-fallback}` references in string values,
 * with loop detection, depth limiting, and escape support (`\${...}`).
 *
 * @module
 */

/** Maximum recursive expansion depth to prevent runaway loops. */
const MAX_DEPTH = 10;

/**
 * Pattern for interpolation tokens:
 *   - `\${...}` — escaped literal (group 1 captures the braces content)
 *   - `${VAR}` or `${VAR:-fallback}` — interpolation (group 2 = name, group 3 = fallback)
 */
const TOKEN_RE = /\\(\$\{[^}]*\})|(\$\{([^:}]+)(?::-((?:[^}]|(?<=\\)\})*))?(?<!\\)\})/g;

/** Error thrown when a circular reference is detected during interpolation. */
export class InterpolationCycleError extends Error {
  constructor(chain: readonly string[]) {
    super(
      `Circular env-var reference detected: ${chain.join(' → ')}`,
    );
    this.name = 'InterpolationCycleError';
  }
}

/** Error thrown when a circular object reference is detected during interpolation. */
export class InterpolationObjectCycleError extends Error {
  constructor(path: string) {
    super(
      `Circular object reference detected during interpolation at ${path}. ` +
        `Config objects must be JSON-like (acyclic).`,
    );
    this.name = 'InterpolationObjectCycleError';
  }
}

/** Error thrown when recursive expansion exceeds max depth (not necessarily a cycle). */
export class InterpolationDepthError extends Error {
  constructor(maxDepth: number) {
    super(
      `Environment variable interpolation exceeded maximum depth of ${maxDepth}. ` +
        `This may indicate deeply nested variable references.`,
    );
    this.name = 'InterpolationDepthError';
  }
}

/** Error thrown when a referenced env var is undefined and has no fallback. */
export class UnsetVariableError extends Error {
  constructor(varName: string) {
    super(
      `Environment variable "${varName}" is not set and has no fallback. ` +
        `Use \${${varName}:-default} to provide a fallback value.`,
    );
    this.name = 'UnsetVariableError';
  }
}

/**
 * Interpolate environment variable references in a single string.
 *
 * Supported syntax:
 *   - `${VAR}`           — expand; error if unset
 *   - `${VAR:-fallback}` — expand; use fallback if unset or empty
 *   - `\${VAR}`          — literal `${VAR}` (escape)
 *
 * @param value  - The string containing `${VAR}` references.
 * @param env    - The environment map (defaults to `process.env`).
 * @param _seen  - Internal: tracks visited vars for cycle detection.
 * @param _depth - Internal: current recursion depth.
 * @returns The string with all references expanded.
 * @throws {InterpolationCycleError} If a circular reference is detected.
 * @throws {UnsetVariableError} If a variable is unset with no fallback.
 */
export function interpolateString(
  value: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  _seen: Set<string> = new Set(),
  _depth = 0,
): string {
  if (_depth > MAX_DEPTH) {
    throw new InterpolationDepthError(MAX_DEPTH);
  }

  return value.replace(
    TOKEN_RE,
    (
      _match: string,
      escaped: string | undefined,
      _fullRef: string | undefined,
      varName: string | undefined,
      fallback: string | undefined,
    ): string => {
      // Escaped literal: \${FOO} → ${FOO}
      if (escaped !== undefined) {
        return escaped;
      }

      if (varName === undefined) return _match;

      // Cycle detection
      if (_seen.has(varName)) {
        throw new InterpolationCycleError([..._seen, varName]);
      }

      const envValue = env[varName];

      // Resolve the raw value (env value or fallback)
      let resolved: string;
      if (envValue !== undefined && envValue !== '') {
        resolved = envValue;
      } else if (fallback !== undefined) {
        // Use fallback when unset OR empty (shell-like semantics).
        // Allow escaped closing braces: `${VAR:-a\}b}` -> `a}b`
        resolved = fallback.replace(/\\}/g, '}');
      } else if (envValue === '') {
        // Empty string with no fallback defined; return as-is
        resolved = envValue;
      } else {
        throw new UnsetVariableError(varName);
      }

      // Recursively expand if the resolved value itself contains ${...}
      if (resolved.includes('${')) {
        const nextSeen = new Set(_seen);
        nextSeen.add(varName);
        return interpolateString(resolved, env, nextSeen, _depth + 1);
      }

      return resolved;
    },
  );
}

/**
 * Recursively walk an object/array and interpolate all string values.
 * Non-string values are returned unchanged. Objects are shallow-cloned
 * to avoid mutating the input.
 *
 * @param obj - The object/array/value to interpolate.
 * @param env - The environment map.
 * @returns A new object with all string values interpolated.
 */
export function interpolateDeep<T>(
  obj: T,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): T {
  const stack = new WeakSet<object>();

  function walk(value: unknown, path: string): unknown {
    if (typeof value === 'string') {
      return interpolateString(value, env);
    }
    if (Array.isArray(value)) {
      // Arrays can be self-referential; include them in cycle detection.
      if (stack.has(value)) {
        throw new InterpolationObjectCycleError(path);
      }
      stack.add(value);
      try {
        return value.map((item, idx) => walk(item, `${path}[${idx}]`));
      } finally {
        stack.delete(value);
      }
    }
    if (value !== null && typeof value === 'object') {
      const objValue = value as object;
      if (stack.has(objValue)) {
        throw new InterpolationObjectCycleError(path);
      }
      stack.add(objValue);
      try {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          result[k] = walk(v, `${path}.${k}`);
        }
        return result;
      } finally {
        stack.delete(objValue);
      }
    }
    return value;
  }

  return walk(obj, '$') as T;
}
