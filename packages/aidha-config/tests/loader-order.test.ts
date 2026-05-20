// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/loader.js';
import { resolveConfig } from '../src/resolver.js';

/**
 * End-to-end tests for the 8-step load order:
 *
 *   1. Discover config file path
 *   2. Compute base_dir_prelim
 *   3. Parse YAML
 *   3.5. Structural validation
 *   4. Load dotenv files (relative to base_dir_prelim)
 *   5. Interpolate top-level resolution fields
 *   6. Compute final base_dir
 *   7. Resolve and interpolate active tiers (during resolveConfig)
 *   8. Semantic validation (during resolveConfig)
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
default_profile: \${DEFAULT_PROFILE}
env:
  dotenv_files:
    - values.env
profiles:
  prod: {}
`);
    writeFile('values.env', 'DEFAULT_PROFILE=prod\n');

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    // default_profile should be interpolated in loadConfig
    expect(result.config!.default_profile).toBe('prod');
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

    // db path should be resolved relative to baseDir DURING resolveConfig
    const resolved = resolveConfig({ rawConfig: result.config, baseDir: result.baseDir });
    expect(resolved.db).toBe(resolve(tmpDir, './data/test.sqlite'));
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
    writeFile('dirs.env', `CUSTOM_BASE=custom-root\n`);
    mkdirSync(join(tmpDir, 'custom-root'), { recursive: true });

    const result = await loadConfig({ cwd: tmpDir, env: {} });
    const expectedBase = join(tmpDir, 'custom-root');
    expect(result.baseDir).toBe(expectedBase);

    const resolved = resolveConfig({ rawConfig: result.config, baseDir: result.baseDir });
    expect(resolved.db).toBe(resolve(expectedBase, './db.sqlite'));
  });

  it('should validate semantically after interpolation in resolveConfig', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
profiles:
  default:
    llm:
      timeout_ms: -100
`);
    const loadResult = await loadConfig({ cwd: tmpDir });
    // structural validation (Pass 1) should pass as timeout_ms: -100 is valid object structure
    expect(loadResult.config).toBeDefined();

    // Semantic validation (Pass 2) should fail in resolveConfig
    expect(() => resolveConfig({ rawConfig: loadResult.config })).toThrow(/validation/i);
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
    const loadResult = await loadConfig({ cwd: tmpDir, env: {} });
    expect(loadResult.baseDir).toBe(expectedBase);

    const resolved = resolveConfig({ rawConfig: loadResult.config, baseDir: loadResult.baseDir });
    expect(resolved.db).toBe(resolve(expectedBase, './out/data.sqlite'));
    expect(resolved.llm.cacheDir).toBe(resolve(expectedBase, './cache'));
  });

  it('should only interpolate the active profile (lazy)', async () => {
    writeFile('.aidha/config.yaml', `
config_version: 1
default_profile: default
profiles:
  default:
    llm:
      model: default-model
  staging:
    llm:
      model: \${MISSING_STAGING_VAR}
`);
    const loadResult = await loadConfig({ cwd: tmpDir, env: {} });

    // resolving 'default' should succeed even though MISSING_STAGING_VAR is unset
    const resolved = resolveConfig({ rawConfig: loadResult.config, profileName: 'default' });
    expect(resolved.llm.model).toBe('default-model');

    // resolving 'staging' should fail
    expect(() => resolveConfig({ rawConfig: loadResult.config, profileName: 'staging' })).toThrow(/MISSING_STAGING_VAR/);
  });
});
