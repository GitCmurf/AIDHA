import { describe, it, expect, vi } from 'vitest';

describe('schema loading failures', () => {
  it('wraps schema load/parse errors with path context', async () => {
    vi.resetModules();

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        readFileSync: () => {
          const err = new Error('ENOENT: no such file or directory');
          (err as any).code = 'ENOENT';
          throw err;
        },
      };
    });

    try {
      const { validateConfig } = await import('../src/schema.js');
      expect(() => validateConfig({})).toThrow(/Failed to compile config schema/i);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});
