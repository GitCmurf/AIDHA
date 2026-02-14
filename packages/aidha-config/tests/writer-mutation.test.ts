import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mutateConfig } from '../src/writer.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';

describe('writer mutation (mutateConfig)', () => {
  let tempRoot: string;
  let configPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-writer-mutation-'));
    configPath = join(tempRoot, 'config.yaml');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('sets an existing value and preserves comments', async () => {
    const original = `
# This is a comment
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: gpt-3.5-turbo # inline comment
    `;
    await writeFile(configPath, original, 'utf-8');

    const result = mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.llm.model',
      value: 'gpt-4o',
    });

    expect(result.written).toBe(true);

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toContain('# This is a comment');
    expect(updated).toContain('# inline comment');
    expect(updated).toContain('model: gpt-4o');
  });

  it('sets a new value and creates parent maps', async () => {
    const original = `
config_version: 1
default_profile: local
profiles:
  local: {}
    `;
    await writeFile(configPath, original, 'utf-8');

    mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.llm.timeout_ms',
      value: '5000',
    });

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toContain('timeout_ms: 5000');
    // Verify type conversion (it should be a number in YAML, no quotes)
    expect(updated).toMatch(/timeout_ms:\s+5000/);
  });

  it('performs type conversion (string -> boolean)', async () => {
     const original = `
config_version: 1
default_profile: local
profiles:
  local:
    editor:
      editor_llm: false
    `;
    await writeFile(configPath, original, 'utf-8');

    mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.editor.editor_llm',
      value: 'true',
    });

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toMatch(/editor_llm:\s+true/);
  });

  it('fails with validation error on schema violation', async () => {
    const original = `
config_version: 1
default_profile: local
profiles:
  local: {}
    `;
    await writeFile(configPath, original, 'utf-8');

    // timeout_ms must be integer >= 0, setting to "negative" or string that isn't valid
    expect(() => mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.llm.timeout_ms',
      value: '-10',
    })).toThrow(/validation failed/i);
  });

  it('rejects empty strings for numeric types', async () => {
    const original = `
config_version: 1
default_profile: local
profiles:
  local: {}
    `;
    await writeFile(configPath, original, 'utf-8');

    expect(() => mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.llm.timeout_ms',
      value: '',
    })).toThrow(/cannot be empty; expected number/i);

    expect(() => mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.llm.timeout_ms',
      value: '   ',
    })).toThrow(/cannot be empty; expected number/i);
  });

  it('preserves YAML anchors (where possible) and updates aliased values via copy-on-write', async () => {
    const original = `
config_version: 1
default_profile: local
profiles:
  base:
    llm: &llm_defaults
      model: gpt-4o
      timeout_ms: 5000
  local:
    llm: *llm_defaults
    `;
    await writeFile(configPath, original, 'utf-8');

    mutateConfig({
      filePath: configPath,
      keyPath: 'profiles.local.llm.model',
      value: 'o1-preview',
    });

    const updated = await readFile(configPath, 'utf-8');
    // Anchor definition should remain in base
    expect(updated).toContain('&llm_defaults');

    // The alias usage *llm_defaults in local should be replaced by the value (broken alias)
    // So distinct validation of the value:
    expect(updated).toContain('model: o1-preview');
  });

  it('respects dryRun', async () => {
    const original = 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}';
    await writeFile(configPath, original, 'utf-8');

    const result = mutateConfig({
      filePath: configPath,
      keyPath: 'default_profile',
      value: 'prod',
      dryRun: true,
    });

    expect(result.written).toBe(false);
    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('default_profile: local');
  });
});
