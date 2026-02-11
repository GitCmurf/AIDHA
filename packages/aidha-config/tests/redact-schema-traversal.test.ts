import { describe, it, expect, vi } from 'vitest';

describe('schema traversal for x-aidha-secret', () => {
  it('discovers secrets in composition/array/additionalProperties', async () => {
    const schema = {
      type: 'object',
      properties: {
        composed: {
          allOf: [
            {
              type: 'object',
              properties: {
                nonce: { type: 'string', 'x-aidha-secret': true },
              },
            },
          ],
        },
        arr: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nonce2: { type: 'string', 'x-aidha-secret': true },
            },
          },
        },
        map: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              nonce3: { type: 'string', 'x-aidha-secret': true },
            },
          },
        },
      },
      $defs: {
        Nested: {
          type: 'object',
          anyOf: [
            {
              type: 'object',
              properties: {
                nonce4: { type: 'string', 'x-aidha-secret': true },
              },
            },
          ],
        },
      },
    };

    vi.resetModules();
    vi.doMock('../src/schema.js', () => ({
      loadSchema: () => schema,
    }));

    const { isSecretKey, redactSecrets, REDACTED } = await import('../src/redact.js');

    expect(isSecretKey('nonce')).toBe(true);
    expect(isSecretKey('nonce2')).toBe(true);
    expect(isSecretKey('nonce3')).toBe(true);
    expect(isSecretKey('nonce4')).toBe(true);

    const redacted = redactSecrets({ nonce: 'x', keep: 'y' } as any);
    expect((redacted as any).nonce).toBe(REDACTED);
    expect((redacted as any).keep).toBe('y');

    vi.doUnmock('../src/schema.js');
  });
});
