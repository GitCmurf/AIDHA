import { describe, it, expect } from 'vitest';
import { createProvenance, formatProvenance, resolveKeyProvenance } from '../src/explain.js';
import type { ConfigTier } from '../src/explain.js';
import { resolveConfig } from '../src/resolver.js';

describe('createProvenance', () => {
  it('should create CLI tier provenance', () => {
    const prov = createProvenance('llm.model', 'cli');
    expect(prov.tier).toBe('cli');
    expect(prov.tierLabel).toContain('Tier 1');
    expect(prov.origin).toContain('CLI flag');
  });

  it('should create profile tier provenance with name', () => {
    const prov = createProvenance('llm.model', 'profile', { profileName: 'fast-local' });
    expect(prov.tier).toBe('profile');
    expect(prov.tierLabel).toContain('Tier 2');
    expect(prov.origin).toBe('profiles.fast-local');
  });

  it('should create source tier provenance with ID', () => {
    const prov = createProvenance('ytdlp.bin', 'source', { sourceId: 'youtube' });
    expect(prov.tier).toBe('source');
    expect(prov.tierLabel).toContain('Tier 3');
    expect(prov.origin).toBe('sources.youtube');
  });

  it('should create default tier provenance', () => {
    const prov = createProvenance('editor.version', 'default');
    expect(prov.tier).toBe('default');
    expect(prov.tierLabel).toContain('Tier 4');
    expect(prov.origin).toBe('profiles.default');
  });

  it('should create hardcoded tier provenance', () => {
    const prov = createProvenance('editor.minChars', 'hardcoded');
    expect(prov.tier).toBe('hardcoded');
    expect(prov.tierLabel).toContain('Tier 5');
    expect(prov.origin).toContain('defaults.ts');
  });

  it('should track isSecret flag', () => {
    const prov = createProvenance('llm.apiKey', 'default', {}, true);
    expect(prov.isSecret).toBe(true);
  });
});

describe('formatProvenance', () => {
  it('should format non-secret value', () => {
    const prov = createProvenance('llm.model', 'profile', { profileName: 'prod' });
    const output = formatProvenance(prov, 'gpt-4o');
    expect(output).toContain('llm.model');
    expect(output).toContain('"gpt-4o"');
    expect(output).toContain('Tier 2');
    expect(output).toContain('profiles.prod');
  });

  it('should redact secret values', () => {
    const prov = createProvenance('llm.apiKey', 'default', {}, true);
    const output = formatProvenance(prov, 'sk-secret123');
    expect(output).toContain('********');
    expect(output).not.toContain('sk-secret123');
  });

  it('should redact empty secret values (security: never leak secrets)', () => {
    const prov = createProvenance('llm.apiKey', 'default', {}, true);
    const output = formatProvenance(prov, '');
    expect(output).toContain('********');
    expect(output).not.toContain('""');
  });

  it('should handle numeric values', () => {
    const prov = createProvenance('llm.timeoutMs', 'hardcoded');
    const output = formatProvenance(prov, 30000);
    expect(output).toContain('30000');
  });

  it('should not throw on unserializable values', () => {
    const prov = createProvenance('test.value', 'cli');
    const obj: Record<string, unknown> = {};
    obj['self'] = obj;
    expect(() => formatProvenance(prov, obj)).not.toThrow();
    const output = formatProvenance(prov, obj);
    expect(output).toContain('test.value');
  });

  it('should include all five tiers', () => {
    const tiers: ConfigTier[] = ['cli', 'profile', 'source', 'default', 'hardcoded'];
    for (const tier of tiers) {
      const prov = createProvenance('test', tier);
      expect(prov.tierLabel).toBeTruthy();
    }
  });
});

describe('resolveKeyProvenance', () => {
  it('uses profile tier when named profile overrides source defaults', () => {
    const rawConfig = {
      config_version: 1,
      default_profile: 'local',
      profiles: {
        local: {
          llm: { model: 'profile-model' },
        },
      },
      sources: {
        youtube: {
          llm: { model: 'source-model' },
        },
      },
    };

    const resolvedConfig = resolveConfig({
      rawConfig,
      profileName: 'local',
      sourceId: 'youtube',
      baseDir: process.cwd(),
    });

    const result = resolveKeyProvenance({
      key: 'llm.model',
      rawConfig,
      resolvedConfig,
      profileName: 'local',
      sourceId: 'youtube',
    });

    expect(result.provenance.tier).toBe('profile');
    expect(result.provenance.origin).toBe('profiles.local');
    expect(result.value).toBe('profile-model');
  });

  it('supports camelCase key lookup against snake_case config paths', () => {
    const rawConfig = {
      config_version: 1,
      default_profile: 'local',
      profiles: {
        local: {
          llm: { base_url: 'https://example.local/v1' },
        },
      },
    };

    const resolvedConfig = resolveConfig({
      rawConfig,
      profileName: 'local',
      baseDir: process.cwd(),
    });

    const result = resolveKeyProvenance({
      key: 'llm.baseUrl',
      rawConfig,
      resolvedConfig,
      profileName: 'local',
    });

    expect(result.provenance.tier).toBe('profile');
    expect(result.provenance.origin).toBe('profiles.local');
    expect(result.value).toBe('https://example.local/v1');
  });

  it('reports hardcoded source-default origin when only built-in source value exists', () => {
    const rawConfig = {
      config_version: 1,
      default_profile: 'local',
      profiles: {
        local: {},
      },
    };

    const resolvedConfig = resolveConfig({
      rawConfig,
      profileName: 'local',
      sourceId: 'youtube',
      baseDir: process.cwd(),
    });

    const result = resolveKeyProvenance({
      key: 'youtube.cookie',
      rawConfig,
      resolvedConfig,
      profileName: 'local',
      sourceId: 'youtube',
    });

    expect(result.provenance.tier).toBe('hardcoded');
    expect(result.provenance.origin).toContain('defaults.ts#sources.youtube');
  });

  it('marks secret keys as secret for explain redaction', () => {
    const resolvedConfig = resolveConfig({
      baseDir: process.cwd(),
    });

    const llmSecret = resolveKeyProvenance({
      key: 'llm.apiKey',
      resolvedConfig,
    });
    const ytSecret = resolveKeyProvenance({
      key: 'youtube.innertubeApiKey',
      resolvedConfig,
    });

    expect(llmSecret.provenance.isSecret).toBe(true);
    expect(ytSecret.provenance.isSecret).toBe(true);
    expect(formatProvenance(llmSecret.provenance, 'sk-live-secret')).toContain('********');
  });
});
