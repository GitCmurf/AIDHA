import { describe, it, expect } from 'vitest';
import { resolveConfig, deepMerge } from '../src/resolver.js';
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
    // These come from hardcoded DEFAULTS (Tier 5)
    expect(resolved.llm.model).toBe('gpt-4o-mini');
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
    // Hardcoded editor defaults still apply
    expect(resolved.editor.version).toBe('v2');
  });

  it('Tier 3: source defaults override system default', () => {
    const config = minimalConfig({
      sources: {
        youtube: {
          extraction: { max_claims: 99 },
          ytdlp: { bin: 'custom-ytdlp', timeout_ms: 5000 },
        },
      },
    });
    const resolved = resolveConfig({ rawConfig: config, sourceId: 'youtube' });
    expect(resolved.extraction.maxClaims).toBe(99);
    expect(resolved.ytdlp.bin).toBe('custom-ytdlp');
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
    expect(resolved.extraction.maxClaims).toBe(50); // from source
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
          db: './tier4.sqlite',                           // Tier 4
          llm: { model: 'tier4-model', timeout_ms: 4000 },
        },
        myprofile: {
          editor: { version: 'v1' },                     // Tier 2
        },
      },
      sources: {
        youtube: {
          extraction: { prompt_version: 'tier3-prompt' }, // Tier 3
        },
      },
    };
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'myprofile',
      sourceId: 'youtube',
      cliOverrides: { llm: { model: 'tier1-model' } },  // Tier 1
    });

    expect(resolved.llm.model).toBe('tier1-model');            // Tier 1
    expect(resolved.editor.version).toBe('v1');                // Tier 2
    expect(resolved.extraction.promptVersion).toBe('tier3-prompt'); // Tier 3
    expect(resolved.db).toBe(resolve(process.cwd(), './tier4.sqlite')); // Tier 4
    expect(resolved.editor.minChars).toBe(50);                 // Tier 5
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('resolveConfig — edge cases', () => {
  it('should handle null rawConfig gracefully', () => {
    const resolved = resolveConfig({ rawConfig: null });
    expect(resolved.llm.model).toBe('gpt-4o-mini'); // hardcoded
  });

  it('should handle missing profile name gracefully', () => {
    const config = minimalConfig();
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'nonexistent',
    });
    // Should still get default profile values
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
