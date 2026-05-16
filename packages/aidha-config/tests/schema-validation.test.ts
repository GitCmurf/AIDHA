import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/schema.js';
import type { SourceRegistration } from '../src/types.js';

/** Helper: creates a minimal valid config for testing. */
function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    config_version: 1,
    default_profile: 'default',
    profiles: {
      default: {
        db: './test.sqlite',
      },
    },
    ...overrides,
  };
}

const MOCK_YOUTUBE_REGISTRATION: SourceRegistration = {
  sourceId: 'youtube',
  validateActiveSourceConfig(value: unknown) {
    if (value === null || typeof value !== 'object') {
      throw new Error('activeSourceConfig must be an object');
    }

    const obj = value as Record<string, unknown>;
    const ytdlp = obj.ytdlp as Record<string, unknown> | undefined;
    const issues: Array<{ path: string; message: string }> = [];

    if (ytdlp) {
      const timeout = ytdlp.timeout_ms;
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 0) {
        issues.push({
          path: 'ytdlp.timeout_ms',
          message: 'Expected a non-negative integer',
        });
      }

      const keepFiles = ytdlp.keep_files;
      if (typeof keepFiles !== 'boolean') {
        issues.push({
          path: 'ytdlp.keep_files',
          message: 'Expected a boolean',
        });
      }
    }

    if (issues.length > 0) {
      throw { errors: issues };
    }

    return value;
  },
};

describe('validateConfig — strict schema validation', () => {
  it('should accept a minimal valid config', () => {
    const result = validateConfig(validConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept a config with all sections populated', () => {
    const result = validateConfig(
      validConfig({
        base_dir: '.',
        env: {
          dotenv_files: ['.env', '.env.local'],
          override_existing: false,
          dotenv_required: false,
        },
        sources: {
          youtube: {
            ytdlp: { bin: 'yt-dlp', cookies_file: '', timeout_ms: 120000, js_runtimes: '', keep_files: false },
            youtube: { cookie: '', innertube_api_key: '', debug_transcript: false },
          },
        },
        profiles: {
          default: {
            db: './test.sqlite',
            source_overrides: {
              youtube: {
                ytdlp: { timeout_ms: 90000 },
                youtube: { debug_transcript: true },
              },
            },
          },
        },
        extensions: { custom_key: 'custom_value' },
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept source_overrides inside a profile', () => {
    const result = validateConfig(
      validConfig({
        profiles: {
          default: {
            db: './test.sqlite',
            source_overrides: {
              youtube: {
                ytdlp: { timeout_ms: 90000 },
                youtube: { debug_transcript: true },
              },
            },
          },
        },
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject invalid core sections inside source_overrides', () => {
    const result = validateConfig(
      validConfig({
        profiles: {
          default: {
            db: './test.sqlite',
            source_overrides: {
              youtube: {
                extraction: { max_claims: 'many' as unknown as number },
              },
            },
          },
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'type')).toBe(true);
    expect(result.errors.some((e) => e.path.includes('/profiles/default/source_overrides/youtube/extraction/max_claims'))).toBe(true);
  });

  it('should validate known source-private overrides through source registrations', () => {
    const result = validateConfig(
      validConfig({
        profiles: {
          default: {
            db: './test.sqlite',
            source_overrides: {
              youtube: {
                ytdlp: {
                  timeout_ms: -1,
                  keep_files: 'maybe',
                },
              },
            },
          },
        },
      }),
      [MOCK_YOUTUBE_REGISTRATION],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === '/profiles/default/source_overrides/youtube/ytdlp/timeout_ms')).toBe(true);
    expect(result.errors.some((e) => e.path === '/profiles/default/source_overrides/youtube/ytdlp/keep_files')).toBe(true);
  });

  // ── Strict validation: unknown keys rejected ──────────────────────────

  it('should reject unknown top-level keys', () => {
    const result = validateConfig(validConfig({ unknown_key: 'bad' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('should reject unknown keys inside a profile', () => {
    const config = validConfig({
      profiles: {
        default: { db: './test.sqlite', typo_key: 'bad' },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('should reject unknown keys inside llm config', () => {
    const config = validConfig({
      profiles: {
        default: { llm: { model: 'gpt-4o', unknown_llm_key: true } },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('should allow arbitrary source-private keys inside source defaults', () => {
    const config = validConfig({
      sources: {
        youtube: {
          widget: { timeout_ms: 5000 },
        },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject unknown keys inside env config', () => {
    const config = validConfig({
      env: { dotenv_files: [], unknown_env_key: true },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
  });

  // ── Extensions pass-through ───────────────────────────────────────────

  it('should allow arbitrary keys inside top-level extensions', () => {
    const config = validConfig({ extensions: { my_tool: { setting: 42 } } });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should allow arbitrary keys inside per-profile extensions', () => {
    const config = validConfig({
      profiles: {
        default: { db: './test.sqlite', extensions: { my_plugin: { enabled: true } } },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should allow arbitrary keys inside per-source extensions', () => {
    const config = validConfig({
      sources: {
        youtube: { extensions: { custom_source_config: { flag: 'on' } } },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  // ── Type validation ───────────────────────────────────────────────────

  it('should reject non-integer config_version', () => {
    const result = validateConfig(validConfig({ config_version: 'one' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'type')).toBe(true);
  });

  it('should reject config_version less than 1', () => {
    const result = validateConfig(validConfig({ config_version: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'minimum')).toBe(true);
  });

  it('should reject non-string default_profile', () => {
    const result = validateConfig(validConfig({ default_profile: 42 }));
    expect(result.valid).toBe(false);
  });

  it('should reject negative timeout_ms', () => {
    const config = validConfig({
      profiles: { default: { llm: { timeout_ms: -1 } } },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
  });

  // ── Missing required fields ───────────────────────────────────────────

  it('should reject config missing config_version', () => {
    const config = { default_profile: 'default', profiles: {} };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('should reject config missing profiles', () => {
    const config = { config_version: 1, default_profile: 'default' };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  // ── Named profiles: any name allowed, but shape is validated ──────────

  it('should allow arbitrary profile names', () => {
    const config = validConfig({
      profiles: {
        default: { db: './test.sqlite' },
        'fast-local': { llm: { model: 'ollama/llama3' } },
        production: { llm: { model: 'gpt-4o' } },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should allow arbitrary source IDs', () => {
    const config = validConfig({
      sources: {
        youtube: { ytdlp: { bin: 'yt-dlp' } },
        'rss-feed': { extraction: { max_claims: 10 } },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });
});
