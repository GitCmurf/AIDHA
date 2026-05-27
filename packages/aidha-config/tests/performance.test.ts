// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/loader.js';
import { resolveConfig } from '../src/resolver.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';

describe('Configuration Performance Budget', () => {
  let tempRoot: string;
  let configPath: string;

  const createConfig = async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-config-perf-'));
    configPath = join(tempRoot, 'config.yaml');
    const content = `
config_version: 1
default_profile: local
profiles:
  local:
    llm:
      model: gpt-4o-mini
    source_overrides:
      youtube:
        ytdlp:
          keep_files: true
  prod:
    llm:
      model: gpt-4o
sources:
  youtube:
    ytdlp:
      timeout_ms: 60000
`;
    await writeFile(configPath, content);
    await chmod(configPath, 0o600);
  };

  const cleanup = async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };

  it('loader + resolver completes under 250ms', async () => {
    await createConfig();

    // Warm up
    await loadConfig({ configPath });

    const start = performance.now();
    const { config, baseDir } = await loadConfig({ configPath });
    resolveConfig({
      rawConfig: config,
      baseDir,
      profileName: 'local',
      sourceId: 'youtube'
    });
    const end = performance.now();
    const duration = end - start;

    // console.log(`Config load + resolve duration: ${duration.toFixed(2)}ms`);

    // 250ms allows for CI variance and container overhead.
    expect(duration).toBeLessThan(250);

    await cleanup();
  });
});
