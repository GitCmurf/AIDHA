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

  it('should not contain source-specific defaults (owned by source packages)', () => {
    expect(DEFAULTS.sources).toBeUndefined();
  });

  it('should have sensible numeric defaults', () => {
    const llm = DEFAULTS.profiles['default']?.llm;
    expect(llm?.timeout_ms).toBeGreaterThan(0);
  });

  it('should have empty strings for secret fields (not hardcoded values)', () => {
    const llm = DEFAULTS.profiles['default']?.llm;
    expect(llm?.api_key).toBe('');
  });

  it('should have reasoning_effort and verbosity with valid defaults', () => {
    const llm = DEFAULTS.profiles['default']?.llm;
    expect(llm?.reasoning_effort).toBe('medium');
    expect(llm?.verbosity).toBe('medium');
  });

  it('should have embedding defaults for eval and retrieval clients', () => {
    const llm = DEFAULTS.profiles['default']?.llm;
    expect(llm?.embedding_batch_size).toBe(20);
    expect(llm?.embedding_task_type).toBe('SEMANTIC_SIMILARITY');
    expect(llm?.embedding_output_dimensionality).toBe(768);
  });
});
