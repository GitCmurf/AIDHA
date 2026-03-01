import { describe, it, expect } from 'vitest';
import { redactSecrets, isSecretKey, REDACTED } from '../src/redact.js';

describe('isSecretKey', () => {
  it('should detect schema-annotated secret keys (snake_case)', () => {
    expect(isSecretKey('api_key')).toBe(true);
    expect(isSecretKey('cookie')).toBe(true);
    expect(isSecretKey('innertube_api_key')).toBe(true);
  });

  it('should detect camelCase equivalents of schema secrets', () => {
    expect(isSecretKey('apiKey')).toBe(true);
  });

  it('should detect heuristic secrets by pattern', () => {
    expect(isSecretKey('mySecret')).toBe(true);
    expect(isSecretKey('auth_token')).toBe(true);
    expect(isSecretKey('password')).toBe(true);
    expect(isSecretKey('credential')).toBe(true);
  });

  it('should not flag non-secret keys', () => {
    expect(isSecretKey('model')).toBe(false);
    expect(isSecretKey('timeout_ms')).toBe(false);
    expect(isSecretKey('version')).toBe(false);
    expect(isSecretKey('db')).toBe(false);
  });

  it('should avoid common false positives from broad substrings', () => {
    expect(isSecretKey('keyboardLayout')).toBe(false);
    expect(isSecretKey('keynote')).toBe(false);
    expect(isSecretKey('primaryKey')).toBe(false);
    expect(isSecretKey('author')).toBe(false);
    expect(isSecretKey('authority')).toBe(false);
  });
});

describe('redactSecrets', () => {
  it('should redact secret string values', () => {
    const result = redactSecrets({
      apiKey: 'sk-abc123',
      model: 'gpt-4o',
    });
    expect(result.apiKey).toBe(REDACTED);
    expect(result.model).toBe('gpt-4o');
  });

  it('should redact empty secret strings (security: never leak secret fields)', () => {
    const result = redactSecrets({ apiKey: '' });
    expect(result.apiKey).toBe(REDACTED);
  });

  it('should redact secret non-string values', () => {
    const result = redactSecrets({
      apiKey: 12345,
      cookie: { session: 'abc' },
      model: 'gpt-4o',
    });
    expect(result.apiKey).toBe(REDACTED);
    expect(result.cookie).toBe(REDACTED);
    expect(result.model).toBe('gpt-4o');
  });

  it('should handle nested objects', () => {
    const result = redactSecrets({
      llm: {
        apiKey: 'secret-value',
        model: 'gpt-4o',
        timeoutMs: 30000,
      },
      youtube: {
        cookie: 'session-data',
        debugTranscript: false,
      },
    });
    expect(result.llm.apiKey).toBe(REDACTED);
    expect(result.llm.model).toBe('gpt-4o');
    expect(result.youtube.cookie).toBe(REDACTED);
    expect(result.youtube.debugTranscript).toBe(false);
  });

  it('should not mutate the input', () => {
    const input = { apiKey: 'original' };
    const inputCopy = { ...input };
    redactSecrets(input);
    expect(input).toEqual(inputCopy);
  });

  it('should handle null, undefined, and primitives', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets('text')).toBe('text');
  });

  it('should handle arrays', () => {
    const result = redactSecrets([{ apiKey: 'secret' }, { model: 'gpt' }]);
    expect(result[0]?.apiKey).toBe(REDACTED);
    expect(result[1]?.model).toBe('gpt');
  });

  it('should throw error for keys exceeding maximum length (ReDoS protection)', () => {
    // The toSnakeCase function (used internally by isSecretKey) has a MAX_KEY_LENGTH of 256.
    // This prevents ReDoS attacks on the regex and ensures keys that end with secret
    // patterns (e.g., '..._password') are not silently truncated, which would bypass redaction.
    const longKey = 'a'.repeat(256) + '_password';
    expect(() => isSecretKey(longKey)).toThrow(/Key length .* exceeds maximum/);
  });

  it('should handle keys at the maximum length boundary', () => {
    // Keys exactly at the limit should work fine
    const maxLengthKey = 'a'.repeat(256);
    expect(() => isSecretKey(maxLengthKey)).not.toThrow();
    expect(isSecretKey(maxLengthKey)).toBe(false);

    // '_password' is 9 characters, so 247 + 9 = 256 exactly
    const maxLengthSecretKey = 'a'.repeat(247) + '_password';
    expect(() => isSecretKey(maxLengthSecretKey)).not.toThrow();
    expect(isSecretKey(maxLengthSecretKey)).toBe(true);
  });
});
