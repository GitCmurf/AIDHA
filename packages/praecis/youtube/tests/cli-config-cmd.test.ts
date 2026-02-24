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

    const code = await runCli(['config', 'path', '--config', configPath, '--source', 'youtube']);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
    expect(code).toBe(2);
  });

  it('validate rejects --source', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runCli(['config', 'validate', '--config', configPath, '--source', 'youtube']);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
    expect(code).toBe(2);
  });

  it('list-profiles rejects --source', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runCli(['config', 'list-profiles', '--config', configPath, '--source', 'youtube']);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
    expect(code).toBe(2);
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
    // runCli should handle validation error and return 1
    const code = await runCli(['config', 'validate', '--config', configPath]);
    expect(code).toBe(1);
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

  it('explain honors --source', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: default-model
sources:
  twitter:
    llm:
      model: source-model
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Should pick source-model because source tier > default profile tier,
    // IF --source is respected.
    const code = await runCli(['config', 'explain', 'llm.model', '--config', configPath, '--source', 'twitter']);

    expect(code).toBe(0);
    // Provenance output: "llm.model: source-model (from source:twitter)"
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('from sources.twitter'));
  });

  it('explain handles camelCase keys (llm.baseUrl)', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      base_url: http://localhost:1234
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // User queries "llm.baseUrl" (camelCase), but config has "base_url" (snake_case)
    const code = await runCli(['config', 'explain', 'llm.baseUrl', '--config', configPath]);

    expect(code).toBe(0);
    // Should find it in 'profile' tier, not 'hardcoded' or undefined
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('profiles.local'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('http://localhost:1234'));
  });

  it('validate handles broken YAML gracefully', async () => {
    await writeFile(configPath, '\tinvalid yaml', 'utf-8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should return 0 (or 1 handled?) and print "Config is invalid" or specific error,
    // NOT throw unhandled exception / crash.
    // The previous implementation tests expected it to throw, now we want it handled.
    // If runCli catches and exits 1, that's "crashing" in the sense of CLI runner,
    // but we want `config validate` to output formatted error.

    const code = await runCli(['config', 'validate', '--config', configPath]);

    expect(code).toBe(1); // It validates as "invalid", so code 1.
    // But it should process it via runConfigValidate, not crash in resolveCliConfig.
    // How to distinguish? Console output.
    // If it crashed in loader, it prints error stack or message.
    // If it ran validate, it prints "Config is invalid: ..."
    // Current loader throws ConfigParseError.

    // We want the CLI to print a friendly message.
    // If we catch in cli.ts and pass to runConfig, we can print "Config is invalid".
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error: Failed to load configuration.'));
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

  it('get redacts secret values by default', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      api_key: sk-test-123
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'get', 'llm.apiKey', '--config', configPath]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith('********');
    expect(consoleLog).not.toHaveBeenCalledWith('sk-test-123');
  });

  it('get --show-secrets requires --yes in non-TTY', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      api_key: sk-test-123
`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli([
      'config',
      'get',
      'llm.apiKey',
      '--config',
      configPath,
      '--show-secrets',
    ]);
    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('requires --yes'));
  });

  it('get --show-secrets --yes prints secret value in non-TTY', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      api_key: sk-test-123
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli([
      'config',
      'get',
      'llm.apiKey',
      '--config',
      configPath,
      '--show-secrets',
      '--yes',
    ]);
    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith('sk-test-123');
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

  it('explain handles missing key', async () => {
    await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runCli(['config', 'explain', 'missing.key', '--config', configPath]);
    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Key not found'));
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

  it('explain without --source does NOT use source defaults (Round 3 Repro)', async () => {
    await createConfig(`
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: local-model
sources:
  youtube:
    llm:
      model: source-model
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Without --source, it should resolve to 'local-model' (Tier 4 or Tier 2), NOT 'source-model' (Tier 3).
    // The defect reporting says it currently picks source-model.
    const code = await runCli(['config', 'explain', 'llm.model', '--config', configPath]);

    expect(code).toBe(0);
    // If defect is present, this expectation will fail (it will print source-model).
    // checking for correct behavior:
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('local-model'));
  });

  it('explain reports default profile origin correctly when using fallback (Round 3 Repro)', async () => {
    await createConfig(`
config_version: 1
default_profile: default
profiles:
  default:
    llm:
      model: default-model
  prod:
    # inherits llm.model from default
    llm: {}
`);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Requesting profile 'prod', but value comes from 'default' profile.
    const code = await runCli(['config', 'explain', 'llm.model', '--config', configPath, '--profile', 'prod']);

    expect(code).toBe(0);

    // Should say "from profiles.default"
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('profiles.default'));
    expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('profiles.prod'));
  });

  it('validate reports correct file path on load failure (Round 3 Repro)', async () => {
    await writeFile(configPath, '\tinvalid yaml', 'utf-8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Run validate without --config (simulating auto-discovery via env vars or discovery logic testing)
    const originalEnv = process.env.AIDHA_CONFIG;
    process.env.AIDHA_CONFIG = configPath;

    try {
        const code = await runCli(['config', 'validate']);
        expect(code).toBe(1);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(configPath));
    } finally {
        if (originalEnv) process.env.AIDHA_CONFIG = originalEnv;
        else delete process.env.AIDHA_CONFIG;
    }
  });


  it('validate reports AIDHA_CONFIG path on load failure (Round 5 Repro)', async () => {
    await writeFile(configPath, '\tinvalid yaml', 'utf-8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalEnv = process.env.AIDHA_CONFIG;
    process.env.AIDHA_CONFIG = configPath;

    try {
        // Run without --config, so it uses AIDHA_CONFIG
        const code = await runCli(['config', 'validate']);
        expect(code).toBe(1);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(configPath));
    } finally {
        if (originalEnv) process.env.AIDHA_CONFIG = originalEnv;
        else delete process.env.AIDHA_CONFIG;
    }
  });

  it('validate reports project-local path on load failure (Round 5 Repro)', async () => {
    // Mock project-local config in .aidha/config.yaml
    const projectLocalDir = join(tempRoot, '.aidha');
    await import('node:fs/promises').then(fs => fs.mkdir(projectLocalDir, { recursive: true }));
    const projectLocalPath = join(projectLocalDir, 'config.yaml');
    await writeFile(projectLocalPath, '\tinvalid yaml', 'utf-8');

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure no override
    const originalEnv = process.env.AIDHA_CONFIG;
    delete process.env.AIDHA_CONFIG;

    try {
        const code = await runCli(['config', 'validate']);
        expect(code).toBe(1);
        // It should pick up .aidha/config.yaml and report it
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(projectLocalPath));
    } finally {
        if (originalEnv) process.env.AIDHA_CONFIG = originalEnv;
    }
  });

  describe('Policy Validation: --source applicability', () => {
    // Subcommands that MUST reject --source
    const prohibited = ['path', 'validate', 'list-profiles', 'show'];
    // Subcommands that MAY accept --source
    const allowed = ['get', 'explain', 'init'];

    it.each(prohibited)('config %s rejects --source', async (subcommand) => {
        await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Some commands require extra logic to run, but rejection happens first.
        // init might try to write, so we use dry-run just in case it bypasses check (it shouldn't).
        const extraArgs = subcommand === 'init' ? ['--dry-run', '--force'] : ['--config', configPath];

        const code = await runCli(['config', subcommand, ...extraArgs, '--source', 'youtube']);

        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
        expect(code).toBe(2);
    });

    it.each(allowed)('config %s accepts --source', async (subcommand) => {
        await createConfig(`
config_version: 1
default_profile: local
profiles:
  local: {}
sources:
  youtube:
    llm:
      model: source-model
`);
        // We just check that it doesn't return code 2 (rejection).
        // It might return 1 if key missing, or 0 if successful.
        // We query a key that exists in source to be safe.
        // For 'explain' -> 'llm.model'
        // For 'get' -> 'llm.model'
        const code = await runCli(['config', subcommand, 'llm.model', '--config', configPath, '--source', 'youtube']);
        expect(code).not.toBe(2);
    });

    it('validate reports project-local path on schema validation failure (Phase 2A Polish)', async () => {
      // Mock project-local config in .aidha/config.yaml with valid YAML but invalid schema
      const projectLocalDir = join(tempRoot, '.aidha');
      await import('node:fs/promises').then(fs => fs.mkdir(projectLocalDir, { recursive: true }));
      const projectLocalPath = join(projectLocalDir, 'config.yaml');
      // invalid schema: llm.model must be string, here it is number
      await writeFile(projectLocalPath, 'config_version: 1\ndefault_profile: local\nprofiles:\n  local:\n    llm:\n      model: 123', 'utf-8');

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Ensure no override
      const originalEnv = process.env.AIDHA_CONFIG;
      delete process.env.AIDHA_CONFIG;

      try {
          const code = await runCli(['config', 'validate']);
          expect(code).toBe(1);
          // It should report the path in the error message
          expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(projectLocalPath));
      } finally {
          if (originalEnv) process.env.AIDHA_CONFIG = originalEnv;
      }
    });

    it('show prints friendly error on config load failure (Phase 2A Round 7)', async () => {
        // Create invalid YAML file
        const invalidPath = join(tempRoot, 'invalid.yaml');
        await writeFile(invalidPath, 'invalid_yaml: [ unclosed', 'utf-8');

        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const code = await runCli(['config', 'show', '--config', invalidPath]);

        expect(code).toBe(1);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error: Failed to load configuration.'));
        expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('SyntaxError')); // Should be wrapped/message
    });

    it('get prints friendly error on config load failure (Phase 2A Round 7)', async () => {
        const invalidPath = join(tempRoot, 'invalid.yaml');
        await writeFile(invalidPath, 'invalid_yaml: [ unclosed', 'utf-8');

        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const code = await runCli(['config', 'get', 'foo', '--config', invalidPath]);

        expect(code).toBe(1);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error: Failed to load configuration.'));
    });

    it('list-profiles fails fast on config error (Phase 2A Round 8)', async () => {
        const invalidPath = join(tempRoot, 'invalid.yaml');
        await writeFile(invalidPath, 'invalid_yaml: [ unclosed', 'utf-8');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const code = await runCli(['config', 'list-profiles', '--config', invalidPath]);
        expect(code).toBe(1);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error: Failed to load configuration.'));
    });

    it('explain works in zero-config mode (Phase 2A Round 8)', async () => {
      // No config file created.
      // Should use internals defaults.
      // We check that it doesn't crash and returns 0 or 1 (key not found).
      // We'll check a key that should exist in defaults (e.g. llm.model)
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      const code = await runCli(['config', 'explain', 'llm.model']);

      // If it fails with "No config loaded", code is 1. If "Key not found", code is 1.
      // But we want it to NOT fail with "No config loaded".
      // llm.model is in defaults? Yes: DEFAULTS.profiles.default.llm.model = 'gpt-4o-mini'

      expect(code).toBe(0);
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('gpt-4o-mini'));
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Hardcoded'));
    });

    it('show rejects --source with exit code 2 (Phase 2A Round 8)', async () => {
      await createConfig('config_version: 1\ndefault_profile: local\nprofiles:\n  local: {}');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const code = await runCli(['config', 'show', '--config', configPath, '--source', 'youtube']);

      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('--source is not applicable'));
      expect(code).toBe(2);
    });
  });

  test('config get resolves RSS defaults (Active Source)', async () => {
    // Prove RSS config is "live" via --source defaults
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['config', 'get', 'rss.pollIntervalMinutes', '--source', 'rss']);

    expect(code).toBe(0);
    // Should resolve to 60 from DEFAULTS.sources.rss (Tier 5)
    expect(consoleLog).toHaveBeenCalledWith('60');
  });

});
