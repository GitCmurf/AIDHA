import { describe, it, expect } from 'vitest';
import { DEFAULTS } from '../src/defaults.js';
import { validateConfig } from '../src/schema.js';
import { SUPPORTED_CONFIG_VERSION } from '../src/types.js';

describe('DEFAULTS', () => {
  it('should validate against the JSON Schema', () => {
    const result = validateConfig(DEFAULTS);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('should have config_version matching SUPPORTED_CONFIG_VERSION', () => {
    expect(DEFAULTS.config_version).toBe(SUPPORTED_CONFIG_VERSION);
  });

  it('should have a default_profile set to "default"', () => {
    expect(DEFAULTS.default_profile).toBe('default');
  });

  it('should have a complete default profile with all top-level sections', () => {
    const defaultProfile = DEFAULTS.profiles['default'];
    expect(defaultProfile).toBeDefined();
    expect(defaultProfile?.db).toBeDefined();
    expect(defaultProfile?.llm).toBeDefined();
    expect(defaultProfile?.editor).toBeDefined();
    expect(defaultProfile?.extraction).toBeDefined();
    expect(defaultProfile?.export).toBeDefined();
  });

  it('should have YouTube source defaults', () => {
    const youtubeSrc = DEFAULTS.sources?.['youtube'];
    expect(youtubeSrc).toBeDefined();
    expect(youtubeSrc?.ytdlp).toBeDefined();
    expect(youtubeSrc?.youtube).toBeDefined();
    expect(youtubeSrc?.extraction).toBeDefined();
  });

  it('should have sensible numeric defaults', () => {
    const llm = DEFAULTS.profiles['default']?.llm;
    expect(llm?.timeout_ms).toBeGreaterThan(0);
    const ytdlp = DEFAULTS.sources?.['youtube']?.ytdlp;
    expect(ytdlp?.timeout_ms).toBeGreaterThan(0);
  });

  it('should have empty strings for secret fields (not hardcoded values)', () => {
    const llm = DEFAULTS.profiles['default']?.llm;
    expect(llm?.api_key).toBe('');
    const youtube = DEFAULTS.sources?.['youtube']?.youtube;
    expect(youtube?.cookie).toBe('');
  });
});
