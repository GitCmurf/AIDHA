import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../src/cli.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';

describe('CLI Config Set Regressions (Phase 2B)', () => {
  let tempRoot: string;
  let configPath: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-config-set-reg-'));
    configPath = join(tempRoot, 'config.yaml');
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('permits set command and validates behavior', async () => {
    await writeFile(configPath, 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}\n', 'utf-8');

    // Success path
    const code = await runCli(['config', 'set', 'default_profile', 'prod', '--config', configPath]);
    expect(code).toBe(0);

    // Validation failure path
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failCode = await runCli(['config', 'set', 'config_version', '0', '--config', configPath]);
    expect(failCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('validation failed'));
  });
});
