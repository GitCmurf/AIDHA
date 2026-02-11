import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/loader.js';

/**
 * End-to-end tests for the 8-step load order:
 *
 *   1. Discover config file path
 *   2. Compute base_dir_prelim
 *   3. Parse YAML
 *   4. Load dotenv files (relative to base_dir_prelim)
 *   5. Interpolate ${VAR} references (using dotenv-loaded values)
 *   6. Validate against JSON Schema
 *   7. Compute final base_dir (may use interpolated override)
 *   8. Resolve path-like values relative to final base_dir
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aidha-loader-order-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(subPath: string, content: string): void {
  const filePath = join(tmpDir, subPath);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

describe('Loader — 8-step load order', () => {
  it('should load dotenv before interpolation (steps 4→5)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
env:
  dotenv_files:
    - secrets.env
profiles:
  default:
    llm:
      api_key: \${SECRET_FROM_DOTENV}
`);
    writeFile('secrets.env', 'SECRET_FROM_DOTENV=my-secret-key\n');

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    expect(result.config!.profiles['default']?.llm?.api_key).toBe('my-secret-key');
  });

  it('should resolve base_dir from .aidha/ parent (step 2)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
profiles:
  default:
    db: ./data/test.sqlite
`);

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    // base_dir_prelim should be tmpDir (parent of .aidha/)
    expect(result.baseDir).toBe(tmpDir);
    // db path should be resolved relative to baseDir
    expect(result.config!.profiles['default']?.db).toBe(
      resolve(tmpDir, './data/test.sqlite'),
    );
  });

  it('should apply base_dir override after interpolation (steps 5→7)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
env:
  dotenv_files:
    - dirs.env
base_dir: \${CUSTOM_BASE}
profiles:
  default:
    db: ./db.sqlite
`);
    writeFile('dirs.env', `CUSTOM_BASE=${join(tmpDir, 'custom-root')}\n`);
    mkdirSync(join(tmpDir, 'custom-root'), { recursive: true });

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    const expectedBase = join(tmpDir, 'custom-root');
    expect(result.baseDir).toBe(expectedBase);
    expect(result.config!.profiles['default']?.db).toBe(
      resolve(expectedBase, './db.sqlite'),
    );
  });

  it('should validate after interpolation (step 6)', async () => {
    // The config has a valid structure, but uses ${} for values
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
profiles:
  default:
    llm:
      timeout_ms: \${TIMEOUT}
`);
    // TIMEOUT will be interpolated as a string "30000", but schema expects integer.
    // This should fail at validation (step 6) because "30000" is a string, not integer.
    await expect(
      loadConfig({ cwd: tmpDir, env: { TIMEOUT: '30000' } }),
    ).rejects.toThrow(/validation/i);
  });

  it('should resolve paths relative to final base_dir, not prelim (step 8)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
base_dir: subproject
profiles:
  default:
    db: ./out/data.sqlite
    llm:
      cache_dir: ./cache
`);
    const expectedBase = resolve(tmpDir, 'subproject');
    const result = await loadConfig({ cwd: tmpDir, env: {} });
    expect(result.baseDir).toBe(expectedBase);
    expect(result.config!.profiles['default']?.db).toBe(
      resolve(expectedBase, './out/data.sqlite'),
    );
    expect(result.config!.profiles['default']?.llm?.cache_dir).toBe(
      resolve(expectedBase, './cache'),
    );
  });

  it('should not rewrite bare command names during path resolution (step 8)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
profiles:
  default: {}
sources:
  youtube:
    ytdlp:
      bin: yt-dlp
      cookies_file: ./cookies.txt
`);

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    const ytdlp = result.config!.sources?.['youtube']?.ytdlp;
    expect(ytdlp?.bin).toBe('yt-dlp'); // bare command — not resolved
    expect(ytdlp?.cookies_file).toBe(resolve(tmpDir, './cookies.txt'));
  });

  it('should load multiple dotenv files in order (later wins)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
env:
  dotenv_files:
    - base.env
    - override.env
profiles:
  default:
    llm:
      model: \${MODEL}
`);
    writeFile('base.env', 'MODEL=base-model\n');
    writeFile('override.env', 'MODEL=override-model\n');

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    expect(result.config!.profiles['default']?.llm?.model).toBe('override-model');
  });
});
