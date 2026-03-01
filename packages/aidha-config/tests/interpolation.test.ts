import { describe, it, expect } from 'vitest';
import {
  interpolateString,
  interpolateDeep,
  InterpolationCycleError,
  InterpolationDepthError,
  InterpolationObjectCycleError,
  UnsetVariableError,
} from '../src/interpolation.js';

const env = (vars: Record<string, string>): Record<string, string | undefined> => vars;

describe('interpolateString', () => {
  // ── Basic expansion ───────────────────────────────────────────────────

  it('should expand ${VAR} with env value', () => {
    expect(interpolateString('Hello ${NAME}', env({ NAME: 'World' }))).toBe(
      'Hello World',
    );
  });

  it('should expand multiple variables in one string', () => {
    expect(
      interpolateString('${A}-${B}', env({ A: 'foo', B: 'bar' })),
    ).toBe('foo-bar');
  });

  it('should return strings without ${} unchanged', () => {
    expect(interpolateString('no vars here', env({}))).toBe('no vars here');
  });

  it('should return empty string unchanged', () => {
    expect(interpolateString('', env({}))).toBe('');
  });

  // ── Fallback defaults ────────────────────────────────────────────────

  it('should use fallback when var is unset', () => {
    expect(interpolateString('${MISSING:-default}', env({}))).toBe('default');
  });

  it('should use fallback when var is empty string', () => {
    expect(interpolateString('${EMPTY:-fallback}', env({ EMPTY: '' }))).toBe(
      'fallback',
    );
  });

  it('should use env value over fallback when set', () => {
    expect(
      interpolateString('${VAR:-fallback}', env({ VAR: 'actual' })),
    ).toBe('actual');
  });

  it('should allow empty fallback', () => {
    expect(interpolateString('${MISSING:-}', env({}))).toBe('');
  });

  it('should allow closing brace in fallback via \\}', () => {
    expect(interpolateString('${MISSING:-a\\}b}', env({}))).toBe('a}b');
  });

  // ── Unset variable errors ────────────────────────────────────────────

  it('should throw UnsetVariableError for unset var without fallback', () => {
    expect(() => interpolateString('${MISSING}', env({}))).toThrow(
      UnsetVariableError,
    );
  });

  it('should throw UnsetVariableError with helpful message', () => {
    expect(() => interpolateString('${API_KEY}', env({}))).toThrow(
      /API_KEY.*not set/,
    );
  });

  // ── Escape sequences ────────────────────────────────────────────────

  it('should treat \\${VAR} as literal ${VAR}', () => {
    expect(interpolateString('\\${NOT_A_VAR}', env({}))).toBe(
      '${NOT_A_VAR}',
    );
  });

  it('should mix escaped and real interpolation', () => {
    expect(
      interpolateString('\\${LITERAL} ${REAL}', env({ REAL: 'expanded' })),
    ).toBe('${LITERAL} expanded');
  });

  // ── Recursive expansion ──────────────────────────────────────────────

  it('should recursively expand nested references', () => {
    expect(
      interpolateString('${OUTER}', env({ OUTER: '${INNER}', INNER: 'deep' })),
    ).toBe('deep');
  });

  // ── Cycle detection ──────────────────────────────────────────────────

  it('should detect direct self-reference cycle', () => {
    expect(() =>
      interpolateString('${A}', env({ A: '${A}' })),
    ).toThrow(InterpolationCycleError);
  });

  it('should detect two-step cycle (A→B→A)', () => {
    expect(() =>
      interpolateString('${A}', env({ A: '${B}', B: '${A}' })),
    ).toThrow(InterpolationCycleError);
  });

  it('should include cycle chain in error message', () => {
    let thrown: unknown;
    try {
      interpolateString('${X}', env({ X: '${Y}', Y: '${X}' }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InterpolationCycleError);
    expect((thrown as Error).message).toContain('→');
  });

  // ── Max depth (non-cyclic) ────────────────────────────────────────────

  it('should throw InterpolationDepthError (not CycleError) for excessive depth', () => {
    // Build a chain of 12 unique vars: V0 -> V1 -> ... -> V11 -> "end"
    // This exceeds MAX_DEPTH (10) without being a cycle.
    const vars: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      vars[`V${i}`] = `${String.fromCharCode(65 + i)}-\${V${i + 1}}`;
    }
    vars['V12'] = 'end';
    expect(() => interpolateString('${V0}', env(vars))).toThrow(
      InterpolationDepthError,
    );
  });

  // ── ReDoS protection (length limits) ─────────────────────────────────────

  it('should throw error for input strings exceeding maximum length (ReDoS protection)', () => {
    // The interpolateString function has a MAX_INPUT_LENGTH of 10000 to prevent
    // potential ReDoS attacks on the complex TOKEN_RE regex.
    const tooLong = 'a'.repeat(10001);
    expect(() => interpolateString(tooLong, env({}))).toThrow(
      /Input string length .* exceeds maximum/,
    );
  });

  it('should handle strings at the maximum length boundary', () => {
    // Strings exactly at the limit should work fine
    const maxLength = 'a'.repeat(10000);
    expect(() => interpolateString(maxLength, env({}))).not.toThrow();
    expect(interpolateString(maxLength, env({}))).toBe(maxLength);
  });

  it('should interpolate strings at maximum length with variables', () => {
    // Verify that interpolation works correctly at the length boundary
    // ${VAR} is 6 characters, so 9994 + 6 = 10000 exactly
    const longValue = 'x'.repeat(9994);
    expect(() => interpolateString(`${longValue}\${VAR}`, env({ VAR: 'y' }))).not.toThrow();
    expect(interpolateString(`${longValue}\${VAR}`, env({ VAR: 'y' }))).toBe(longValue + 'y');
  });
});

describe('interpolateDeep', () => {
  it('should interpolate all string values in a nested object', () => {
    const input = {
      llm: { api_key: '${KEY}', model: 'gpt-4o' },
      db: '${DB_PATH}',
      count: 42,
      flag: true,
    };
    const result = interpolateDeep(input, env({ KEY: 'secret', DB_PATH: '/tmp/db' }));
    expect(result).toEqual({
      llm: { api_key: 'secret', model: 'gpt-4o' },
      db: '/tmp/db',
      count: 42,
      flag: true,
    });
  });

  it('should not mutate the input object', () => {
    const input = { key: '${VAR}' };
    const original = { ...input };
    interpolateDeep(input, env({ VAR: 'value' }));
    expect(input).toEqual(original);
  });

  it('should handle arrays', () => {
    const input = { files: ['${A}', '${B}'] };
    const result = interpolateDeep(input, env({ A: 'one', B: 'two' }));
    expect(result).toEqual({ files: ['one', 'two'] });
  });

  it('should pass through null and undefined', () => {
    expect(interpolateDeep(null, env({}))).toBeNull();
    expect(interpolateDeep(undefined, env({}))).toBeUndefined();
  });

  it('should handle deeply nested structures', () => {
    const input = { a: { b: { c: '${DEEP}' } } };
    const result = interpolateDeep(input, env({ DEEP: 'found' }));
    expect(result).toEqual({ a: { b: { c: 'found' } } });
  });

  it('should throw InterpolationObjectCycleError on circular objects', () => {
    const input: any = { value: '${X}' };
    input.self = input;
    expect(() => interpolateDeep(input, env({ X: 'ok' }))).toThrow(
      InterpolationObjectCycleError,
    );
  });

  it('should throw InterpolationObjectCycleError on circular arrays', () => {
    const arr: any[] = [];
    arr.push(arr);
    expect(() => interpolateDeep(arr as any, env({}))).toThrow(
      InterpolationObjectCycleError,
    );
  });
});
