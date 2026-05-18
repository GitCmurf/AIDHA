// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  discoverConfigPath,
  ConfigParseError,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigVersionError,
} from '../src/loader.js';
import { resolveConfig } from '../src/resolver.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aidha-config-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a YAML string to a config file inside tmpDir. */
function writeConfig(yaml: string, subPath = '.aidha/config.yaml'): string {
  const filePath = join(tmpDir, subPath);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, yaml, 'utf-8');
  return filePath;
}

const MINIMAL_YAML = `
config_version: 1
default_profile: default
profiles:
  default:
    db: ./out/test.sqlite
`;

// ── discoverConfigPath ───────────────────────────────────────────────────────

describe('discoverConfigPath', () => {
  it('should find project-local .aidha/config.yaml', () => {
    writeConfig(MINIMAL_YAML);
    const path = discoverConfigPath(undefined, tmpDir);
    expect(path).toBe(join(tmpDir, '.aidha', 'config.yaml'));
  });

  it('should use env override when provided', () => {
    const filePath = writeConfig(MINIMAL_YAML, 'custom/config.yaml');
    const path = discoverConfigPath(filePath);
    expect(path).toBe(filePath);
  });

  it('should resolve relative env override against provided cwd', () => {
    const filePath = writeConfig(MINIMAL_YAML, 'custom/config.yaml');
    const path = discoverConfigPath('./custom/config.yaml', tmpDir);
    expect(path).toBe(filePath);
  });

  it('should return null when env override path does not exist', () => {
    const path = discoverConfigPath('/nonexistent/config.yaml');
    expect(path).toBeNull();
  });

  it('should return null when no config file exists', () => {
    const path = discoverConfigPath(undefined, tmpDir);
    expect(path).toBeNull();
  });

  it('should use caller env for XDG_CONFIG_HOME discovery', () => {
    const xdgHome = join(tmpDir, 'xdg-home');
    const xdgConfig = join(xdgHome, 'aidha', 'config.yaml');
    mkdirSync(dirname(xdgConfig), { recursive: true });
    writeFileSync(xdgConfig, MINIMAL_YAML, 'utf-8');

    const path = discoverConfigPath(undefined, tmpDir, {
      XDG_CONFIG_HOME: xdgHome,
    });

    expect(path).toBe(xdgConfig);
  });
});

// ── loadConfig ───────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('should return null config when no file exists', async () => {
    const result = await loadConfig({ cwd: tmpDir });
    expect(result.config).toBeNull();
    expect(result.configPath).toBeNull();
    expect(result.baseDir).toBe(tmpDir);
  });

  it('should throw ConfigNotFoundError when explicit configPath override does not exist', async () => {
    await expect(
      loadConfig({ cwd: tmpDir, configPath: join(tmpDir, 'missing.yaml'), env: {} }),
    ).rejects.toThrow(ConfigNotFoundError);
  });

  it('should resolve explicit relative configPath against caller cwd', async () => {
    const filePath = writeConfig(MINIMAL_YAML);
    const callerCwd = join(tmpDir, 'caller');
    mkdirSync(callerCwd, { recursive: true });

    const result = await loadConfig({
      cwd: callerCwd,
      configPath: '../.aidha/config.yaml',
      env: {},
    });

    expect(result.configPath).toBe(filePath);
  });

  it('should throw ConfigNotFoundError when AIDHA_CONFIG points to missing file', async () => {
    await expect(
      loadConfig({ cwd: tmpDir, env: { AIDHA_CONFIG: join(tmpDir, 'missing.yaml') } }),
    ).rejects.toThrow(ConfigNotFoundError);
  });

  it('should load and parse a minimal config', async () => {
    writeConfig(MINIMAL_YAML);
    const result = await loadConfig({ cwd: tmpDir });
    expect(result.config).not.toBeNull();
    expect(result.config!.config_version).toBe(1);
    expect(result.config!.default_profile).toBe('default');
    expect(result.configPath).toBe(join(tmpDir, '.aidha', 'config.yaml'));
  });

  it('should compute baseDir from .aidha/ path (project root)', async () => {
    writeConfig(MINIMAL_YAML);
    const result = await loadConfig({ cwd: tmpDir });
    expect(result.baseDir).toBe(tmpDir);
  });

  it('should throw ConfigParseError for malformed YAML', async () => {
    writeConfig('{ invalid yaml: [');
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(ConfigParseError);
  });

  it('should throw ConfigValidationError for invalid schema', async () => {
    writeConfig(`
config_version: 1
default_profile: default
profiles:
  default:
    unknown_key: bad
`);
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(ConfigValidationError);
  });

  it('should throw ConfigValidationError for structural errors before interpolation', async () => {
    writeConfig(`
config_version: 1
default_profile: default
profiles:
  default:
    env:
      dotenv_files:
        - .env
    unknown_section: bad
`);
    try {
      await loadConfig({ cwd: tmpDir, env: {} });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const errors = (e as ConfigValidationError).errors;
      expect(errors.some(
        (err) => err.path.includes('default') && err.message.includes('additional'),
      )).toBe(true);
    }
  });

  it.each([
    ['llm', 'llm: []', '/profiles/default/llm'],
    ['source_overrides', 'source_overrides: []', '/profiles/default/source_overrides'],
  ])('should throw ConfigValidationError for malformed nested profile %s sections', async (_label, snippet, expectedPath) => {
    writeConfig(`
config_version: 1
default_profile: default
profiles:
  default:
    db: ./out/test.sqlite
    ${snippet}
`);

    try {
      await loadConfig({ cwd: tmpDir, env: {} });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const errors = (e as ConfigValidationError).errors;
      expect(errors.some((err) => err.path === expectedPath && err.message.includes('must be object'))).toBe(true);
    }
  });

  it.each([
    ['base_dir', 'base_dir: 42'],
    ['env', 'env: []'],
    ['profiles', 'profiles: 1'],
  ])('should throw ConfigValidationError for malformed top-level %s types', async (_label, snippet) => {
    writeConfig(`
config_version: 1
default_profile: default
${snippet}
`);

    await expect(loadConfig({ cwd: tmpDir, env: {} })).rejects.toThrow(ConfigValidationError);
  });

  it('should throw ConfigVersionError for unsupported version', async () => {
    writeConfig(`
config_version: 999
default_profile: default
profiles:
  default: {}
`);
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(ConfigVersionError);
  });

  it('should use explicit configPath override', async () => {
    const filePath = writeConfig(MINIMAL_YAML, 'custom/my-config.yaml');
    const result = await loadConfig({ configPath: filePath });
    expect(result.config).not.toBeNull();
    expect(result.configPath).toBe(filePath);
  });

  it('should NOT interpolate ${VAR} references eagerly', async () => {
    writeConfig(`
config_version: 1
default_profile: default
profiles:
  default:
    llm:
      api_key: \${TEST_API_KEY}
`);
    const result = await loadConfig({
      cwd: tmpDir,
      env: { TEST_API_KEY: 'sk-test-key' },
    });
    // loadConfig now returns raw uninterpolated config
    expect(result.config!.profiles['default']?.llm?.api_key).toBe('${TEST_API_KEY}');
  });

  it('should resolve ${VAR} when passed through resolveConfig', async () => {
    writeConfig(`
config_version: 1
default_profile: default
profiles:
  default:
    llm:
      api_key: \${TEST_API_KEY}
`);
    vi.stubEnv('TEST_API_KEY', 'sk-test-key');
    const loadResult = await loadConfig({ cwd: tmpDir });
    const resolved = resolveConfig({ rawConfig: loadResult.config });
    expect(resolved.llm.apiKey).toBe('sk-test-key');
    vi.unstubAllEnvs();
  });

  it('should interpolate literal escapes from double-quoted YAML scalars in resolveConfig', async () => {
    writeConfig(
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        '    llm:',
        '      api_key: "\\\\${TEST_API_KEY}"',
      ].join('\n'),
    );

    const loadResult = await loadConfig({ cwd: tmpDir });
    const resolved = resolveConfig({ rawConfig: loadResult.config });

    expect(resolved.llm.apiKey).toBe('${TEST_API_KEY}');
  });

  it('should respect caller env for XDG discovery in loadConfig', async () => {
    const processXdgHome = join(tmpDir, 'xdg-process');
    const callerXdgHome = join(tmpDir, 'xdg-caller');

    mkdirSync(join(processXdgHome, 'aidha'), { recursive: true });
    mkdirSync(join(callerXdgHome, 'aidha'), { recursive: true });

    writeFileSync(
      join(processXdgHome, 'aidha', 'config.yaml'),
      `
config_version: 1
default_profile: process
profiles:
  process: {}
`,
      'utf-8',
    );
    writeFileSync(
      join(callerXdgHome, 'aidha', 'config.yaml'),
      `
config_version: 1
default_profile: caller
profiles:
  caller: {}
`,
      'utf-8',
    );

    const originalXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = processXdgHome;

    try {
      const result = await loadConfig({
        cwd: tmpDir,
        env: { XDG_CONFIG_HOME: callerXdgHome },
      });

      expect(result.configPath).toBe(join(callerXdgHome, 'aidha', 'config.yaml'));
      expect(result.config!.default_profile).toBe('caller');
    } finally {
      if (originalXdg === undefined) {
        delete process.env['XDG_CONFIG_HOME'];
      } else {
        process.env['XDG_CONFIG_HOME'] = originalXdg;
      }
    }
  });
});

// ── Dotenv loading ───────────────────────────────────────────────────────────

describe('loadConfig — dotenv', () => {
  it('should load .env files and use values in resolveConfig', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
profiles:
  default:
    llm:
      api_key: \${FROM_DOTENV}
`);
    // Write .env file relative to base_dir_prelim (parent of .aidha/)
    writeFileSync(join(tmpDir, '.env.test'), 'FROM_DOTENV=dotenv-value\n');

    const env: Record<string, string | undefined> = {};
    const result = await loadConfig({ cwd: tmpDir, env });
    expect(result.dotenvEnv['FROM_DOTENV']).toBe('dotenv-value');

    // We must stub the env for resolveConfig since it uses process.env
    vi.stubEnv('FROM_DOTENV', 'dotenv-value');
    const resolved = resolveConfig({ rawConfig: result.config });
    expect(resolved.llm.apiKey).toBe('dotenv-value');
    vi.unstubAllEnvs();
  });

  it('should throw ConfigValidationError for malformed dotenv_files entries', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
    - 123
profiles:
  default: {}
`);

    await expect(loadConfig({ cwd: tmpDir, env: {} })).rejects.toMatchObject({
      name: 'ConfigValidationError',
      errors: [
        {
          path: '/env/dotenv_files/1',
          message: expect.stringContaining('string'),
        },
      ],
    });
  });

  it('should return empty dotenvEnv when no dotenv files configured', async () => {
    writeConfig(`
config_version: 1
default_profile: default
profiles:
  default: {}
`);
    const result = await loadConfig({ cwd: tmpDir, env: {} });
    expect(result.dotenvEnv).toEqual({});
  });

  it('should warn on missing dotenv file by default', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - nonexistent.env
profiles:
  default: {}
`);
    const result = await loadConfig({ cwd: tmpDir, env: {} });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('nonexistent.env'))).toBe(true);
  });

  it('should skip dotenv files reached through a symlinked directory', async () => {
    const externalRoot = mkdtempSync(join(tmpdir(), 'aidha-dotenv-external-'));
    const externalDir = join(externalRoot, 'outside');
    const linkedDir = join(tmpDir, 'linked');

    try {
      mkdirSync(externalDir, { recursive: true });
      writeFileSync(join(externalDir, 'secret.env'), 'TRAVERSAL=value\n', 'utf-8');

      try {
        symlinkSync(externalDir, linkedDir, 'dir');
      } catch {
        return;
      }

      writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - linked/secret.env
profiles:
  default: {}
`);

      const result = await loadConfig({ cwd: tmpDir, env: {} });

      expect(result.dotenvEnv['TRAVERSAL']).toBeUndefined();
      expect(result.warnings.some((w) => w.includes('resolves outside the config base directory'))).toBe(true);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it('should error on missing dotenv file when dotenv_required is true', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - nonexistent.env
  dotenv_required: true
profiles:
  default: {}
`);
    try {
      await loadConfig({ cwd: tmpDir, env: {} });
      throw new Error('Expected loadConfig to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).filePath).toBe(join(tmpDir, '.aidha', 'config.yaml'));
      expect((error as ConfigValidationError).errors).toHaveLength(1);
      expect((error as ConfigValidationError).errors[0]).toMatchObject({
        path: '/env/dotenv_files',
      });
      expect((error as ConfigValidationError).errors[0].message).toContain('Dotenv file not found:');
    }
  });

  it('should not override existing env vars by default in resolveConfig', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
profiles:
  default:
    llm:
      api_key: \${EXISTING_VAR}
`);
    writeFileSync(join(tmpDir, '.env.test'), 'EXISTING_VAR=from-dotenv\n');

    vi.stubEnv('EXISTING_VAR', 'from-shell');
    const result = await loadConfig({ cwd: tmpDir });
    const resolved = resolveConfig({ rawConfig: result.config });
    expect(resolved.llm.apiKey).toBe('from-shell');
    vi.unstubAllEnvs();
  });

  it('should override existing env vars when override_existing is true in resolveConfig', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
  override_existing: true
profiles:
  default:
    llm:
      api_key: \${OVERRIDE_VAR}
`);
    writeFileSync(join(tmpDir, '.env.test'), 'OVERRIDE_VAR=from-dotenv\n');

    vi.stubEnv('OVERRIDE_VAR', 'from-shell');
    // loadConfig with syncProcessEnv: true will update process.env
    const result = await loadConfig({ cwd: tmpDir, syncProcessEnv: true });
    const resolved = resolveConfig({ rawConfig: result.config });
    expect(resolved.llm.apiKey).toBe('from-dotenv');
    vi.unstubAllEnvs();
  });

  it('should sync dotenv values into process.env when syncProcessEnv is true', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
profiles:
  default:
    llm:
      api_key: \${AIDHA_SYNC_DOTENV_VAR}
`);
    writeFileSync(join(tmpDir, '.env.test'), 'AIDHA_SYNC_DOTENV_VAR=from-dotenv\n'); // pragma: allowlist secret

    const originalProcessValue = process.env['AIDHA_SYNC_DOTENV_VAR'];
    delete process.env['AIDHA_SYNC_DOTENV_VAR'];

    try {
      const env: Record<string, string | undefined> = { CUSTOM_ENV: 'caller-value' };
      const result = await loadConfig({ cwd: tmpDir, env, syncProcessEnv: true });
      expect(result.dotenvEnv['AIDHA_SYNC_DOTENV_VAR']).toBe('from-dotenv');
      expect(process.env['AIDHA_SYNC_DOTENV_VAR']).toBe('from-dotenv');
      expect(env['AIDHA_SYNC_DOTENV_VAR']).toBe('from-dotenv');
    } finally {
      if (originalProcessValue === undefined) {
        delete process.env['AIDHA_SYNC_DOTENV_VAR'];
      } else {
        process.env['AIDHA_SYNC_DOTENV_VAR'] = originalProcessValue;
      }
    }
  });

  it('should sync dotenv values into process.env even when the shell has a stale value', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
profiles:
  default:
    llm:
      api_key: \${AIDHA_SYNC_DOTENV_VAR}
`);
    writeFileSync(join(tmpDir, '.env.test'), 'AIDHA_SYNC_DOTENV_VAR=from-dotenv\n'); // pragma: allowlist secret

    const originalProcessValue = process.env['AIDHA_SYNC_DOTENV_VAR'];
    process.env['AIDHA_SYNC_DOTENV_VAR'] = 'stale-shell-value';

    try {
      const env: Record<string, string | undefined> = { CUSTOM_ENV: 'caller-value' };
      const result = await loadConfig({ cwd: tmpDir, env, syncProcessEnv: true });
      expect(result.dotenvEnv['AIDHA_SYNC_DOTENV_VAR']).toBe('from-dotenv');
      expect(env['AIDHA_SYNC_DOTENV_VAR']).toBe('from-dotenv');
      expect(process.env['AIDHA_SYNC_DOTENV_VAR']).toBe('from-dotenv');
    } finally {
      if (originalProcessValue === undefined) {
        delete process.env['AIDHA_SYNC_DOTENV_VAR'];
      } else {
        process.env['AIDHA_SYNC_DOTENV_VAR'] = originalProcessValue;
      }
    }
  });

  it('should preserve caller env precedence when syncProcessEnv is true', async () => {
    writeConfig(`
config_version: 1
default_profile: default
env:
  dotenv_files:
    - .env.test
profiles:
  default:
    llm:
      api_key: \${AIDHA_SYNC_DOTENV_VAR}
`);
    writeFileSync(join(tmpDir, '.env.test'), 'AIDHA_SYNC_DOTENV_VAR=from-dotenv\n'); // pragma: allowlist secret

    const originalProcessValue = process.env['AIDHA_SYNC_DOTENV_VAR'];
    process.env['AIDHA_SYNC_DOTENV_VAR'] = 'stale-shell-value';

    try {
      const env: Record<string, string | undefined> = {
        CUSTOM_ENV: 'caller-value',
        AIDHA_SYNC_DOTENV_VAR: 'from-caller-env',
      };
      const result = await loadConfig({ cwd: tmpDir, env, syncProcessEnv: true });
      expect(result.dotenvEnv['AIDHA_SYNC_DOTENV_VAR']).toBeUndefined();
      expect(env['AIDHA_SYNC_DOTENV_VAR']).toBe('from-caller-env');
      expect(process.env['AIDHA_SYNC_DOTENV_VAR']).toBe('stale-shell-value');
    } finally {
      if (originalProcessValue === undefined) {
        delete process.env['AIDHA_SYNC_DOTENV_VAR'];
      } else {
        process.env['AIDHA_SYNC_DOTENV_VAR'] = originalProcessValue;
      }
    }
  });
});
