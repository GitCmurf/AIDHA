import { describe, it, expect } from 'vitest';
import type { SourceRegistration } from '../src/types.js';
import { resolveConfig, deepMerge } from '../src/resolver.js';
import { ConfigValidationError } from '../src/loader.js';
import type { AidhaConfig } from '../src/types.js';
import { resolve } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid AidhaConfig for testing. */
function minimalConfig(overrides: Partial<AidhaConfig> = {}): AidhaConfig {
  return {
    config_version: 1,
    default_profile: 'default',
    profiles: {
      default: {
        db: './config-default.sqlite',
        llm: { model: 'config-default-model', timeout_ms: 1000 },
      },
    },
    ...overrides,
  };
}

const TEST_YOUTUBE_REGISTRATION = {
  sourceId: 'youtube',
  defaults: {
    ytdlp: { timeout_ms: 120000 },
    youtube: { debug_transcript: false },
    extraction: { max_claims: 15 },
  },
  validateActiveSourceConfig: (value: unknown) => value,
};

// ── deepMerge ────────────────────────────────────────────────────────────────

describe('deepMerge', () => {
  it('should merge scalar overwrites', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('should deep-merge nested objects', () => {
    const result = deepMerge(
      { llm: { model: 'a', timeout_ms: 1000 } },
      { llm: { model: 'b' } },
    );
    expect(result).toEqual({ llm: { model: 'b', timeout_ms: 1000 } });
  });

  it('should replace arrays entirely (no concatenation)', () => {
    const result = deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] });
    expect(result).toEqual({ tags: ['c'] });
  });

  it('should not mutate target or source', () => {
    const target = { llm: { model: 'a' } };
    const source = { llm: { model: 'b' } };
    const targetCopy = JSON.parse(JSON.stringify(target));
    const sourceCopy = JSON.parse(JSON.stringify(source));
    deepMerge(target, source);
    expect(target).toEqual(targetCopy);
    expect(source).toEqual(sourceCopy);
  });

  it('should skip undefined source values', () => {
    const result = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('should guard against prototype pollution keys', () => {
    const source = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":1}},"prototype":{"y":2},"safe":1}') as Record<string, unknown>;
    const result = deepMerge({} as Record<string, unknown>, source);
    expect(result.safe).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
  });
});

// ── resolveConfig: Tier tests ────────────────────────────────────────────────

describe('resolveConfig — five-tier merge', () => {
  it('should return hardcoded defaults when no config file or overrides', () => {
    const resolved = resolveConfig();
    expect(resolved.llm.model).toBe('gpt-5-mini');
    expect(resolved.editor.version).toBe('v2');
    expect(resolved.extraction.maxClaims).toBe(15);
    expect(resolved.db).toBe(resolve(process.cwd(), './out/aidha.sqlite'));
  });

  it('Tier 4: system default profile overrides hardcoded', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          llm: { model: 'from-config-default' },
        },
      },
    });
    const resolved = resolveConfig({ rawConfig: config });
    expect(resolved.llm.model).toBe('from-config-default');
    expect(resolved.editor.version).toBe('v2');
  });

  it('Tier 4: system default profile overrides source registration defaults', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          extraction: { max_claims: 30 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });
    expect(resolved.extraction.maxClaims).toBe(30);
  });

  it('Tier 3: source defaults merge core sections into ResolvedConfig', () => {
    const config = minimalConfig({
      sources: {
        youtube: {
          extraction: { max_claims: 99 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
    });
    expect(resolved.extraction.maxClaims).toBe(99);
    expect(resolved.activeSourceId).toBe('youtube');
  });

  it('Tier 3: source defaults outrank default-profile source_overrides when no profileName is supplied', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          source_overrides: {
            youtube: {
              extraction: { max_claims: 5 },
            },
          },
        },
      },
      sources: {
        youtube: {
          extraction: { max_claims: 10 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
    });
    expect(resolved.extraction.maxClaims).toBe(10);
  });

  it('Tier 3: the configured default profile still applies source_overrides when it is not profiles.default', () => {
    const config = minimalConfig({
      default_profile: 'production',
      profiles: {
        default: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 45000 },
            },
          },
        },
        production: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 90000 },
            },
          },
        },
      },
      sources: {
        youtube: {
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(120000);
    expect(ytdlp.bin).toBe('yt-dlp');
  });

  it('Tier 2: explicitly selecting the configured default profile preserves its source_overrides', () => {
    const config = minimalConfig({
      default_profile: 'production',
      profiles: {
        default: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 45000 },
            },
          },
        },
        production: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 90000 },
            },
          },
        },
      },
      sources: {
        youtube: {
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'production',
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(90000);
    expect(ytdlp.bin).toBe('yt-dlp');
  });

  it('Tier 2: named profile source_overrides outrank source defaults and default-profile source_overrides', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 45000 },
            },
          },
        },
        production: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 90000 },
            },
          },
        },
      },
      sources: {
        youtube: {
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'production',
      sourceId: 'youtube',
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(90000);
    expect(ytdlp.bin).toBe('yt-dlp');
  });

  it('Tier 3: source-private fields go into activeSourceConfig', () => {
    const config = minimalConfig({
      sources: {
        youtube: {
          ytdlp: { bin: 'custom-ytdlp', timeout_ms: 5000 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.bin).toBe('custom-ytdlp');
    expect(ytdlp.timeout_ms).toBe(5000);
  });

  it('Tier 2: named profile source_overrides merge core sections into ResolvedConfig', () => {
    const config = minimalConfig({
      profiles: {
        default: {},
        production: {
          source_overrides: {
            youtube: {
              extraction: { max_claims: 5 },
              ytdlp: { timeout_ms: 90000 },
            },
          },
        },
      },
      sources: {
        youtube: {
          extraction: { max_claims: 10 },
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'production',
      sourceId: 'youtube',
    });
    expect(resolved.extraction.maxClaims).toBe(5);
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(90000);
    expect(ytdlp.bin).toBe('yt-dlp');
  });

  it('Tier 2: named profile overrides source defaults', () => {
    const config = minimalConfig({
      profiles: {
        default: { llm: { model: 'default-model' } },
        'fast-local': { llm: { model: 'ollama/llama3', timeout_ms: 60000 } },
      },
      sources: {
        youtube: { extraction: { max_claims: 50 } },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'fast-local',
      sourceId: 'youtube',
    });
    expect(resolved.llm.model).toBe('ollama/llama3');
    expect(resolved.llm.timeoutMs).toBe(60000);
    expect(resolved.extraction.maxClaims).toBe(50);
  });

  it('Tier 1: CLI overrides trump everything', () => {
    const config = minimalConfig({
      profiles: {
        default: { llm: { model: 'default' } },
        production: { llm: { model: 'production' } },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'production',
      cliOverrides: { llm: { model: 'cli-override' } },
    });
    expect(resolved.llm.model).toBe('cli-override');
  });

  it('should exercise all five tiers with different keys', () => {
    const config: AidhaConfig = {
      config_version: 1,
      default_profile: 'default',
      profiles: {
        default: {
          db: './tier4.sqlite',
          llm: { model: 'tier4-model', timeout_ms: 4000 },
        },
        myprofile: {
          editor: { version: 'v1' },
        },
      },
      sources: {
        youtube: {
          extraction: { prompt_version: 'tier3-prompt' },
        },
      },
    };
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'myprofile',
      sourceId: 'youtube',
      cliOverrides: { llm: { model: 'tier1-model' } },
    });

    expect(resolved.llm.model).toBe('tier1-model');
    expect(resolved.editor.version).toBe('v1');
    expect(resolved.extraction.promptVersion).toBe('tier3-prompt');
    expect(resolved.db).toBe(resolve(process.cwd(), './tier4.sqlite'));
    expect(resolved.editor.minChars).toBe(50);
  });
});

// ── Source boundary ──────────────────────────────────────────────────────────

describe('resolveConfig — source boundary', () => {

  it('should not include source-private fields on ResolvedConfig', () => {
    const resolved = resolveConfig({ sourceId: 'youtube' });
    expect('ytdlp' in resolved).toBe(false);
    expect('youtube' in resolved).toBe(false);
    expect('rss' in resolved).toBe(false);
  });

  it('should leave activeSourceConfig undefined when no source is selected', () => {
    const resolved = resolveConfig();
    expect(resolved.activeSourceId).toBeUndefined();
    expect(resolved.activeSourceConfig).toBeUndefined();
  });

  it('should build activeSourceConfig from source defaults', () => {
    const config = minimalConfig({
      sources: {
        youtube: {
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
          youtube: { cookie: '' },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.bin).toBe('yt-dlp');
    expect(ytdlp.timeout_ms).toBe(120000);
  });

  it('should normalize source-private runtime paths before returning activeSourceConfig', () => {
    const sourceRegistration: SourceRegistration = {
      sourceId: 'youtube',
      validateActiveSourceConfig: (value: unknown) => value,
      resolveSourcePaths: (value: unknown, baseDir: string) => {
        const sourceConfig = value as { ytdlp?: { cookies_file?: string } };
        return {
          ...sourceConfig,
          ytdlp: sourceConfig.ytdlp?.cookies_file
            ? { ...sourceConfig.ytdlp, cookies_file: resolve(baseDir, sourceConfig.ytdlp.cookies_file) }
            : sourceConfig.ytdlp,
        };
      },
    };
    const config = minimalConfig({
      profiles: {
        default: {
          source_overrides: {
            youtube: {
              ytdlp: { cookies_file: './cookies.txt' },
            },
          },
        },
      },
    });
    const baseDir = '/tmp/aidha-resolver-paths';
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
      baseDir,
      sourceRegistrations: [sourceRegistration],
    });

    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.cookies_file).toBe(resolve(baseDir, './cookies.txt'));
  });

  it('should keep core source-default sections out of activeSourceConfig', () => {
    const config = minimalConfig({
      sources: {
        youtube: {
          extraction: { max_claims: 10 },
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });

    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });
    expect(resolved.extraction.maxClaims).toBe(10);

    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    expect(sourceConfig.extraction).toBeUndefined();
    expect((sourceConfig.ytdlp as Record<string, unknown>).bin).toBe('yt-dlp');
  });

  it('should merge legacy source-private keys from the default profile', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          ytdlp: { timeout_ms: 120000 },
          youtube: { debug_transcript: false },
        },
      },
    });

    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    const youtube = sourceConfig.youtube as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(120000);
    expect(youtube.debug_transcript).toBe(false);
  });

  it('should merge legacy source-private profile keys into activeSourceConfig', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          ytdlp: { timeout_ms: 120000 },
          youtube: { debug_transcript: false },
        },
        production: {
          ytdlp: { timeout_ms: 90000, keep_files: true },
          youtube: { debug_transcript: true },
        },
      },
    });

    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'production',
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });

    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    const youtube = sourceConfig.youtube as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(90000);
    expect(ytdlp.keep_files).toBe(true);
    expect(youtube.debug_transcript).toBe(true);
  });

  it('should merge profile source_overrides into activeSourceConfig', () => {
    const config = minimalConfig({
      profiles: {
        default: {},
        production: {
          source_overrides: {
            youtube: {
              ytdlp: { timeout_ms: 90000 },
            },
          },
        },
      },
      sources: {
        youtube: {
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'production',
      sourceId: 'youtube',
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.timeout_ms).toBe(90000);
    expect(ytdlp.bin).toBe('yt-dlp');
  });

  it('should read default-profile source_overrides from the configured default profile', () => {
    const config = minimalConfig({
      default_profile: 'production',
      profiles: {
        default: {
          source_overrides: {
            youtube: {
              ytdlp: { cookies_file: './inactive-default-profile-cookies.txt' },
            },
          },
        },
        production: {},
      },
      sources: {
        youtube: {
          ytdlp: { bin: 'yt-dlp', timeout_ms: 120000 },
        },
      },
    });

    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
      sourceRegistrations: [TEST_YOUTUBE_REGISTRATION],
    });

    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const ytdlp = sourceConfig.ytdlp as Record<string, unknown>;
    expect(ytdlp.cookies_file).toBeUndefined();
    expect(ytdlp.bin).toBe('yt-dlp');
  });

  it('should reject invalid core sections inside source_overrides', () => {
    const config = minimalConfig({
      default_profile: 'production',
      profiles: {
        default: {},
        production: {
          source_overrides: {
            youtube: {
              extraction: { max_claims: 'many' as unknown as number },
            },
          },
        },
      },
    });

    expect(() => resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
    })).toThrowError(ConfigValidationError);
    expect(() => resolveConfig({
      rawConfig: config,
      sourceId: 'youtube',
    })).toThrow(/profiles\.production\.source_overrides\.youtube/i);
  });

  it('should merge core-known sections from source defaults into ResolvedConfig', () => {
    const config = minimalConfig({
      sources: {
        youtube: {
          extraction: { max_claims: 10, chunk_minutes: 3 },
          ytdlp: { bin: 'yt-dlp' },
        },
      },
    });
    const resolved = resolveConfig({ rawConfig: config, sourceId: 'youtube' });
    expect(resolved.extraction.maxClaims).toBe(10);
    expect(resolved.extraction.chunkMinutes).toBe(3);
  });

  it('should use source registration defaults when no user config', () => {
    const registration = {
      sourceId: 'test-source',
      defaults: {
        extraction: { max_claims: 77 },
        widget: { name: 'default-widget', timeout_ms: 5000 },
      },
      validateActiveSourceConfig: (v: unknown) => v,
    };
    const resolved = resolveConfig({
      sourceId: 'test-source',
      sourceRegistrations: [registration],
    });
    expect(resolved.extraction.maxClaims).toBe(77);
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const widget = sourceConfig.widget as Record<string, unknown>;
    expect(widget.name).toBe('default-widget');
  });

  it('should let user source defaults override registration defaults', () => {
    const registration = {
      sourceId: 'test-source',
      defaults: { widget: { name: 'default-widget', timeout_ms: 5000 } },
      validateActiveSourceConfig: (v: unknown) => v,
    };
    const config = minimalConfig({
      sources: {
        'test-source': {
          widget: { name: 'user-widget' },
        },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'test-source',
      sourceRegistrations: [registration],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const widget = sourceConfig.widget as Record<string, unknown>;
    expect(widget.name).toBe('user-widget');
    expect(widget.timeout_ms).toBe(5000);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('resolveConfig — edge cases', () => {
  it('should handle null rawConfig gracefully', () => {
    const resolved = resolveConfig({ rawConfig: null });
    expect(resolved.llm.model).toBe('gpt-5-mini');
  });

  it('should handle missing profile name gracefully', () => {
    const config = minimalConfig();
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'nonexistent',
    });
    expect(resolved.llm.model).toBe('config-default-model');
  });

  it('should handle missing source ID gracefully', () => {
    const config = minimalConfig();
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'nonexistent',
    });
    expect(resolved.llm.model).toBe('config-default-model');
  });

  it('should pass through baseDir', () => {
    const resolved = resolveConfig({ baseDir: '/custom/base' });
    expect(resolved.baseDir).toBe('/custom/base');
  });

  it('should use cwd as default baseDir', () => {
    const resolved = resolveConfig();
    expect(resolved.baseDir).toBe(process.cwd());
  });

  it('should resolve hardcoded default paths relative to baseDir', () => {
    const baseDir = '/tmp/aidha-base';
    const resolved = resolveConfig({ baseDir });

    expect(resolved.db).toBe(resolve(baseDir, './out/aidha.sqlite'));
    expect(resolved.llm.cacheDir).toBe(resolve(baseDir, './out/cache/claims'));
    expect(resolved.export.outDir).toBe(resolve(baseDir, './out'));
  });

  it('should discard invalid reasoning_effort and verbosity values during resolution', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          llm: {
            model: 'config-default-model',
            reasoning_effort: 'ultra' as never,
            verbosity: 'verbose' as never,
          },
        },
      },
    });

    expect(() => resolveConfig({ rawConfig: config })).toThrow(/validation/i);
  });


  it('should resolve embedding fields from config and CLI overrides', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          llm: {
            model: 'config-default-model',
            embedding_batch_size: 40,
            embedding_task_type: 'RETRIEVAL_DOCUMENT',
            embedding_output_dimensionality: 512,
          },
        },
      },
    });

    const resolved = resolveConfig({
      rawConfig: config,
      cliOverrides: {
        llm: {
          embedding_batch_size: 12,
          embedding_task_type: 'CLASSIFICATION',
          embedding_output_dimensionality: 256,
        },
      },
    });

    expect(resolved.llm.embeddingBatchSize).toBe(12);
    expect(resolved.llm.embeddingTaskType).toBe('CLASSIFICATION');
    expect(resolved.llm.embeddingOutputDimensionality).toBe(256);
  });

  it('should fall back to safe embedding defaults for unsupported task types', () => {
    const config = minimalConfig({
      profiles: {
        default: {
          llm: {
            model: 'config-default-model',
            embedding_task_type: 'INVALID_TASK' as never,
          },
        },
      },
    });

    expect(() => resolveConfig({ rawConfig: config })).toThrow(/validation/i);
  });

});

// ── Extensions ───────────────────────────────────────────────────────────────

describe('resolveConfig — extensions', () => {
  it('should collect global extensions', () => {
    const config = minimalConfig({ extensions: { my_tool: { enabled: true } } });
    const resolved = resolveConfig({ rawConfig: config });
    expect(resolved.extensions?.global).toEqual({ my_tool: { enabled: true } });
  });

  it('should collect source extensions', () => {
    const config = minimalConfig({
      sources: {
        youtube: { extensions: { yt_plugin: { version: 2 } } },
      },
    });
    const resolved = resolveConfig({ rawConfig: config, sourceId: 'youtube' });
    expect(resolved.extensions?.source).toEqual({ yt_plugin: { version: 2 } });
  });

  it('should collect profile extensions', () => {
    const config = minimalConfig({
      profiles: {
        default: {},
        myp: { extensions: { prof_setting: 'on' } },
      },
    });
    const resolved = resolveConfig({ rawConfig: config, profileName: 'myp' });
    expect(resolved.extensions?.profile).toEqual({ prof_setting: 'on' });
  });

  it('should merge CLI extension overrides into profile extensions', () => {
    const config = minimalConfig({
      profiles: {
        default: {},
        myp: { extensions: { a: 1 } },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'myp',
      cliOverrides: { extensions: { a: 2, b: 3 } },
    });
    expect(resolved.extensions?.profile).toEqual({ a: 2, b: 3 });
  });

  it('should include default profile extensions when no profileName is provided', () => {
    const config = minimalConfig({
      default_profile: 'local',
      profiles: {
        default: {},
        local: { extensions: { by_default: true } },
      },
    });
    const resolved = resolveConfig({ rawConfig: config });
    expect(resolved.extensions?.profile).toEqual({ by_default: true });
  });

  it('should omit extensions when none exist', () => {
    const resolved = resolveConfig();
    expect(resolved.extensions).toBeUndefined();
  });
});
