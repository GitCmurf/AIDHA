import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
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

  it('should return null when env override path does not exist', () => {
    const path = discoverConfigPath('/nonexistent/config.yaml');
    expect(path).toBeNull();
  });

  it('should return null when no config file exists', () => {
    const path = discoverConfigPath(undefined, tmpDir);
    expect(path).toBeNull();
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

  it('should interpolate ${VAR} references', async () => {
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
    expect(result.config!.profiles['default']?.llm?.api_key).toBe('sk-test-key');
  });
});

// ── Dotenv loading ───────────────────────────────────────────────────────────

describe('loadConfig — dotenv', () => {
  it('should load .env files and use values in interpolation', async () => {
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
    expect(result.config!.profiles['default']?.llm?.api_key).toBe('dotenv-value');
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
    await expect(loadConfig({ cwd: tmpDir, env: {} })).rejects.toThrow(
      /not found/,
    );
  });

  it('should not override existing env vars by default', async () => {
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

    const env: Record<string, string | undefined> = { EXISTING_VAR: 'from-shell' };
    const result = await loadConfig({ cwd: tmpDir, env });
    expect(result.config!.profiles['default']?.llm?.api_key).toBe('from-shell');
  });

  it('should override existing env vars when override_existing is true', async () => {
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

    const env: Record<string, string | undefined> = { OVERRIDE_VAR: 'from-shell' };
    const result = await loadConfig({ cwd: tmpDir, env });
    expect(result.config!.profiles['default']?.llm?.api_key).toBe('from-dotenv');
  });
});
