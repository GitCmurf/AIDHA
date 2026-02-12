import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
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

  it('should not rewrite bare command names', () => {
    expect(resolvePathValue('yt-dlp', baseDir)).toBe('yt-dlp');
  });

  it('should return empty strings unchanged', () => {
    expect(resolvePathValue('', baseDir)).toBe('');
  });
});

describe('resolvePathValues', () => {
  const baseDir = '/home/user/project';

  it('should resolve known path-annotated keys in nested config', () => {
    const config = {
      profiles: {
        default: {
          db: './out/test.sqlite',
          llm: {
            cache_dir: './cache',
            model: 'gpt-4o',
          },
          export: {
            out_dir: './exports',
            source_prefix: 'youtube',
          },
        },
      },
    };

    resolvePathValues(config, baseDir);

    expect(config.profiles.default.db).toBe(resolve(baseDir, './out/test.sqlite'));
    expect(config.profiles.default.llm.cache_dir).toBe(resolve(baseDir, './cache'));
    expect(config.profiles.default.llm.model).toBe('gpt-4o'); // not a path
    expect(config.profiles.default.export.out_dir).toBe(resolve(baseDir, './exports'));
    expect(config.profiles.default.export.source_prefix).toBe('youtube'); // not a path
  });

  it('should not rewrite bare command names in path fields', () => {
    const config = {
      sources: {
        youtube: {
          ytdlp: {
            bin: 'yt-dlp',
            cookies_file: './cookies.txt',
          },
        },
      },
    };

    resolvePathValues(config, baseDir);

    expect(config.sources.youtube.ytdlp.bin).toBe('yt-dlp'); // bare command
    expect(config.sources.youtube.ytdlp.cookies_file).toBe(
      resolve(baseDir, './cookies.txt'),
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

    expect(config.profiles.default.list[0].cache_dir).toBe(resolve(baseDir, './cache-a'));
    expect(config.profiles.default.list[1].cache_dir).toBe(resolve(baseDir, './cache-b'));
    expect(config.profiles.default.list[1].model).toBe('gpt-4o');
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
});
