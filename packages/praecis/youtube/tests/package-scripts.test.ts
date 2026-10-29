import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package scripts', () => {
  it('keeps test:ci on the full Vitest suite', () => {
    const packageJsonPath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:ci']).toBe('pnpm run build:test-runtime && vitest run --silent --reporter=dot');
  });

  it('keeps test:full as the exhaustive Vitest command', () => {
    const packageJsonPath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:full']).toBe('pnpm run build:test-runtime && vitest run');
  });

  it.each([
    {
      mode: 'test',
      expected: [
        'node scripts/check-test-scripts.mjs',
        'pnpm security:public-paths',
        'pnpm security:public-paths:test',
        'pnpm test:semantic-quality',
        'pnpm -r --workspace-concurrency=1 test:ci',
      ].join(' && '),
    },
    { mode: 'test:full', expected: 'pnpm -r --workspace-concurrency=1 --if-present test:full' },
  ])('keeps root $mode package dispatch serial and exhaustive', ({ mode, expected }) => {
    const rootPackage = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPackage.scripts?.[mode]).toBe(expected);
  });
});
