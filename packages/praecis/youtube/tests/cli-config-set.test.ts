import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../src/cli.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';

describe('CLI Config Set (Phase 2B)', () => {
  let tempRoot: string;
  let configPath: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-config-set-'));
    configPath = join(tempRoot, 'config.yaml');
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('updates a value and preserves formatting', async () => {
    const yaml = `
# Header comment
config_version: 1 # version
default_profile: local
profiles:
  local:
    llm:
      model: gpt-4o
    `;
    await writeFile(configPath, yaml, 'utf-8');

    const code = await runCli(['config', 'set', 'profiles.local.llm.model', 'o1-preview', '--config', configPath]);
    expect(code).toBe(0);

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toContain('# Header comment');
    expect(updated).toContain('# version');
    expect(updated).toContain('model: o1-preview');
  }, 30000);

  it('automatically discovers and mutates .aidha/config.yaml', async () => {
    const aidhaDir = join(tempRoot, '.aidha');
    const localConfigPath = join(aidhaDir, 'config.yaml');
    await mkdir(aidhaDir);

    await writeFile(localConfigPath, 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}', 'utf-8');

    // Run without --config, should find .aidha/config.yaml
    const code = await runCli(['config', 'set', 'default_profile', 'prod']);
    expect(code).toBe(0);

    const updated = await readFile(localConfigPath, 'utf-8');
    expect(updated).toContain('default_profile: prod');
  });

  it('performs type conversion (string -> number)', async () => {
    await writeFile(configPath, 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}', 'utf-8');

    const code = await runCli(['config', 'set', 'profiles.local.llm.timeout_ms', '3000', '--config', configPath]);
    expect(code).toBe(0);

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toMatch(/timeout_ms: 3000/);
  });

  it('refuses to mutate in dry-run mode', async () => {
    const yaml = 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}';
    await writeFile(configPath, yaml, 'utf-8');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['config', 'set', 'default_profile', 'prod', '--config', configPath, '--dry-run']);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Dry run'));

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toContain('default_profile: local');
  });

  it('reports validation errors from schema', async () => {
    await writeFile(configPath, 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}', 'utf-8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runCli(['config', 'set', 'config_version', '0', '--config', configPath]);
    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('validation failed'));
  });
});
