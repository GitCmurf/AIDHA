import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseDocument } from 'yaml';
import { mutateConfig } from '../src/writer.js';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Writer Alias Mutation', () => {
  const tmpFile = join(tmpdir(), `aidha-config-alias-test-${Date.now()}.yaml`);

  const setupConfig = (yaml: string) => {
    writeFileSync(tmpFile, yaml, 'utf-8');
  };

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
  });

  it('should implement copy-on-write when mutating an alias', () => {
    // Setup: 'default' profile aliases 'base' profile's llm section.
    const yaml = `
config_version: 1
default_profile: default
profiles:
  base:
    llm: &llm_base
      model: gpt-4o
  default:
    llm: *llm_base
`;
    setupConfig(yaml);

    // Mutate 'profiles.default.llm.model'.
    // Objective: Break the alias link so that 'default' gets a copy of 'llm_base'
    // with the new value, while 'base' (the anchor) remains unchanged.
    const result = mutateConfig({
        filePath: tmpFile,
        keyPath: 'profiles.default.llm.model',
        value: 'gpt-4-turbo'
    });

    expect(result.written).toBe(true);
    expect(result.validationErrors).toEqual([]);

    const content = readFileSync(tmpFile, 'utf-8');
    const doc = parseDocument(content);
    const json = doc.toJS() as any;

    // Assert mutation on target
    expect(json.profiles.default.llm.model).toBe('gpt-4-turbo');

    // Assert anchor preservation (Copy-on-Write)
    // The original base profile should NOT be modified.
    expect(json.profiles.base.llm.model).toBe('gpt-4o');
  });
});
