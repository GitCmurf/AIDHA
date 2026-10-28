import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { PATH_PATTERNS, RUNTIME_PATH_PATTERNS } from '../src/schema.generated.js';
import {
  computeBaseDirPrelim,
  computeFinalBaseDir,
  resolvePathValue,
  isBareCommand,
  resolvePathValues,
} from '../src/paths.js';

describe('computeBaseDirPrelim', () => {
  it('should use parent of .aidha/ for project-local config', () => {
    expect(computeBaseDirPrelim('/home/user/project/.aidha/config.yaml')).toBe(
      '/home/user/project',
    );
  });

  it('should use config directory for XDG config', () => {
    expect(computeBaseDirPrelim('/home/user/.config/aidha/config.yaml')).toBe(
      '/home/user/.config/aidha',
    );
  });

  it('should use config directory for arbitrary paths', () => {
    expect(computeBaseDirPrelim('/tmp/my-config/config.yaml')).toBe(
      '/tmp/my-config',
    );
  });
});

describe('computeFinalBaseDir', () => {
  it('should return prelim when no override is provided', () => {
    expect(computeFinalBaseDir('/home/user/project')).toBe('/home/user/project');
  });

  it('should return prelim when override is undefined', () => {
    expect(computeFinalBaseDir('/home/user/project', undefined)).toBe(
      '/home/user/project',
    );
  });

  it('should resolve relative override against prelim', () => {
    expect(computeFinalBaseDir('/home/user/project', './subdir')).toBe(
      resolve('/home/user/project', './subdir'),
    );
  });

  it('should use absolute override directly', () => {
    expect(computeFinalBaseDir('/home/user/project', '/opt/aidha')).toBe(
      '/opt/aidha',
    );
  });
});

describe('isBareCommand', () => {
  it('should return true for bare command names', () => {
    expect(isBareCommand('yt-dlp')).toBe(true);
    expect(isBareCommand('node')).toBe(true);
  });

  it('should return false for paths with separators', () => {
    expect(isBareCommand('./bin/yt-dlp')).toBe(false);
    expect(isBareCommand('/usr/bin/yt-dlp')).toBe(false);
    expect(isBareCommand('bin/yt-dlp')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isBareCommand('')).toBe(false);
  });
});

describe('resolvePathValue', () => {
  const baseDir = '/home/user/project';

  it('should resolve relative paths against baseDir', () => {
    expect(resolvePathValue('./out/db.sqlite', baseDir)).toBe(
      resolve(baseDir, './out/db.sqlite'),
    );
  });

  it('should pass through absolute paths unchanged', () => {
    expect(resolvePathValue('/tmp/absolute.db', baseDir)).toBe('/tmp/absolute.db');
  });

  it('should resolve bare filesystem names against baseDir', () => {
    expect(resolvePathValue('database.sqlite', baseDir)).toBe(resolve(baseDir, 'database.sqlite'));
    expect(resolvePathValue('cache', baseDir)).toBe(resolve(baseDir, 'cache'));
  });

  it('should return empty strings unchanged', () => {
    expect(resolvePathValue('', baseDir)).toBe('');
  });
});

describe('resolvePathValues', () => {
  const databasePatterns = [
    ...PATH_PATTERNS.map(pattern => ({ kind: 'raw', pattern })),
    ...RUNTIME_PATH_PATTERNS.map(pattern => ({ kind: 'runtime', pattern })),
  ].filter(({ pattern }) => pattern.at(-1) === 'db');

  it.each(databasePatterns)('preserves the database sentinel at $kind $pattern and still resolves bare files', ({ pattern }) => {
    const keys = pattern.map(key => key === '*' ? 'selected' : key);
    const makeConfig = (value: string): Record<string, unknown> => {
      let nested: unknown = value;
      for (const key of [...keys].reverse()) nested = { [key]: nested };
      return nested as Record<string, unknown>;
    };
    const memory = makeConfig(':memory:');
    resolvePathValues(memory, '/project/data');
    expect(memory).toEqual(makeConfig(':memory:'));
    const file = makeConfig('bare.sqlite');
    resolvePathValues(file, '/project/data');
    expect(file).toEqual(makeConfig(resolve('/project/data', 'bare.sqlite')));
  });

  it.each([...PATH_PATTERNS, ...RUNTIME_PATH_PATTERNS].filter(pattern =>
    !['db', 'base_dir', 'baseDir'].includes(pattern.at(-1) ?? ''),
  ))('resolves a non-database sentinel string at %j as a filesystem path', (...pattern) => {
    const keys = pattern.map(key => key === '*' ? 'selected' : key);
    const makeConfig = (value: string): Record<string, unknown> => {
      let nested: unknown = value;
      for (const key of [...keys].reverse()) nested = { [key]: nested };
      return nested as Record<string, unknown>;
    };
    const config = makeConfig(':memory:');
    resolvePathValues(config, '/project/data');
    expect(config).toEqual(makeConfig(resolve('/project/data', ':memory:')));
  });

  it('preserves the SQLite sentinel only at schema-qualified database fields', () => {
    const base = '/project/data';
    const config = {
      profiles: { selected: { db: ':memory:', llm: { cache_dir: ':memory:' }, export: { out_dir: ':memory:' } } },
      db: ':memory:', llm: { cacheDir: ':memory:' }, export: { outDir: ':memory:' },
      extensions: { custom: { db: ':memory:' } },
      source_private: { db: ':memory:', cache_dir: ':memory:' },
    };
    resolvePathValues(config, base);
    expect(config.profiles.selected.db).toBe(':memory:');
    expect(config.db).toBe(':memory:');
    expect(config.profiles.selected.llm.cache_dir).toBe(resolve(base, ':memory:'));
    expect(config.profiles.selected.export.out_dir).toBe(resolve(base, ':memory:'));
    expect(config.llm.cacheDir).toBe(resolve(base, ':memory:'));
    expect(config.export.outDir).toBe(resolve(base, ':memory:'));
    expect(config.extensions.custom.db).toBe(':memory:');
    expect(config.source_private).toEqual({ db: ':memory:', cache_dir: ':memory:' });
    expect(resolvePathValue(':memory:', base)).toBe(resolve(base, ':memory:'));
  });

  const baseDir = '/home/user/project';

  it('should resolve known path-annotated keys in nested config', () => {
    const config = {
      profiles: {
        default: {
          db: 'database.sqlite',
          llm: {
            cache_dir: 'cache',
            model: 'gpt-4o',
          },
          export: {
            out_dir: 'exports',
            source_prefix: 'youtube',
          },
        },
      },
    };

    resolvePathValues(config, baseDir);

    expect(config.profiles.default.db).toBe(resolve(baseDir, 'database.sqlite'));
    expect(config.profiles.default.llm.cache_dir).toBe(resolve(baseDir, 'cache'));
    expect(config.profiles.default.llm.model).toBe('gpt-4o'); // not a path
    expect(config.profiles.default.export.out_dir).toBe(resolve(baseDir, 'exports'));
    expect(config.profiles.default.export.source_prefix).toBe('youtube'); // not a path
  });

  it('should not touch source-private nested objects', () => {
    const config = {
      profiles: {
        default: {
          db: './out/test.sqlite',
          source_overrides: {
            youtube: {
              ytdlp: {
                bin: 'yt-dlp',
                cookies_file: './cookies.txt',
              },
            },
          },
        },
      },
    };

    resolvePathValues(config, baseDir);

    expect(config.profiles.default.db).toBe(resolve(baseDir, './out/test.sqlite'));
    expect(config.profiles.default.source_overrides.youtube.ytdlp.cookies_file).toBe(
      './cookies.txt',
    );
  });

  it('should handle configs with no path-like values', () => {
    const config = {
      profiles: {
        default: {
          llm: { model: 'gpt-4o', timeout_ms: 30000 },
        },
      },
    };

    // Should not throw
    resolvePathValues(config as Record<string, unknown>, baseDir);
    expect(config.profiles.default.llm.model).toBe('gpt-4o');
  });

  it('should traverse arrays and resolve nested path-like values', () => {
    const config = {
      profiles: {
        default: {
          list: [
            { cache_dir: './cache-a' },
            { cache_dir: './cache-b', model: 'gpt-4o' },
          ],
        },
      },
    };

    resolvePathValues(config as Record<string, unknown>, baseDir);

    // Array payloads outside schema-qualified config paths are left untouched.
    expect(config.profiles.default.list).toEqual([
      { cache_dir: './cache-a' },
      { cache_dir: './cache-b', model: 'gpt-4o' },
    ]);
  });

  it('should not re-resolve top-level base_dir', () => {
    const config = {
      base_dir: 'subproject',
      profiles: {
        default: {
          db: './out/test.sqlite',
        },
      },
    };
    const finalBaseDir = resolve(baseDir, 'subproject');

    resolvePathValues(config as Record<string, unknown>, finalBaseDir);

    expect(config.base_dir).toBe('subproject');
    expect(config.profiles.default.db).toBe(resolve(finalBaseDir, './out/test.sqlite'));
  });

  it('should not resolve extension payload keys based on leaf-name collisions', () => {
    const config = {
      extensions: {
        my_plugin: {
          out_dir: './plugin-out',
          db: './plugin-db.sqlite',
        },
      },
      profiles: {
        default: {
          extensions: {
            inner: {
              cache_dir: './plugin-cache',
            },
          },
        },
      },
    };

    resolvePathValues(config as Record<string, unknown>, baseDir);

    expect(config.extensions.my_plugin.out_dir).toBe('./plugin-out');
    expect(config.extensions.my_plugin.db).toBe('./plugin-db.sqlite');
    expect(config.profiles.default.extensions.inner.cache_dir).toBe('./plugin-cache');
  });
});
