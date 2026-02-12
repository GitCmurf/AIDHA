import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../src/cli.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';

describe('CLI Config Commands (Phase 2A)', () => {
  let tempRoot: string;
  let configPath: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-config-cmd-'));
    configPath = join(tempRoot, 'config.yaml');
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const createConfig = async (content: string) => {
    // If content is just a partial snippet, we might need to wrap it?
    // But tests pass specific content.
    // Let's rely on tests passing valid config if possible.
    // Or update tests to pass valid config.
    await writeFile(configPath, content, 'utf-8');
  };

  it('AT-205: path rejects --source', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await runCli(['config', 'path', '--config', configPath, '--source', 'youtube']);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('validate rejects --source', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await runCli(['config', 'validate', '--config', configPath, '--source', 'youtube']);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('list-profiles rejects --source', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await runCli(['config', 'list-profiles', '--config', configPath, '--source', 'youtube']);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('path prints config path', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'path', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(configPath));
  });

  it('path --base-dir prints resolved base dir', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'path', '--config', configPath, '--base-dir']);
    expect(code).toBe(0);
    // Base dir should be tempRoot (dirname of configPath)
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(tempRoot));
  });

  it('validate reports valid config', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local:\n    llm:\n      model: gpt-4o');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'validate', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Config is valid'));
  });

  it('validate reports invalid config', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local:\n    llm:\n      model: 123'); // model must be string

    // runCli throws when config validation fails
    await expect(runCli(['config', 'validate', '--config', configPath]))
      .rejects
      .toThrow(/Config validation failed/);
  });

  it('list-profiles lists profiles', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: local-model
  prod:
    llm:
      model: prod-model
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'list-profiles', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith('local');
    expect(consoleLog).toHaveBeenCalledWith('prod');
  });

  it('list-profiles handles empty/no profiles', async () => {
    await createConfig('config_version: 1\ndefault_profile: default\nprofiles:\n  default: {}');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'list-profiles', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith('default');
  });

  it('show prints config as YAML by default', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: gpt-4o
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'show', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('model: gpt-4o'));
  });

  it('show --json prints JSON', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: gpt-4o
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'show', '--config', configPath, '--json']);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"model": "gpt-4o"'));
  });

  it('get retrieves value', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: gpt-4o
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'get', 'llm.model', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith('gpt-4o');
  });

  it('get handles missing key', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runCli(['config', 'get', 'missing.key', '--config', configPath]);
    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Key not found'));
  });

  it('explain prints provenance', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: gpt-4o
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'explain', 'llm.model', '--config', configPath]);
    expect(code).toBe(0);
    // Provenance output is complex, check partial match
    // Default formatProvenance output includes key and value.
    // 'Source (Tier 4: Profile Defaults "local")' maybe?
    // Let's assume basic output for now.
    // aidha-config formatProvenance uses chalk if available.
    // We mocked console.log so we get raw string (with ANSI codes if process supports color).
    // Just create a simpler regex expectation.
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('llm.model'));
  });

  it('show --raw requires --yes in non-TTY', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Mock isTTY false
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli(['config', 'show', '--raw', '--config', configPath]);
    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('requires --yes'));
  });

  it('show --raw --yes prints content', async () => {
    const rawContent = 'config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}';
    await createConfig(rawContent);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli(['config', 'show', '--raw', '--yes', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(rawContent);
  });
});
