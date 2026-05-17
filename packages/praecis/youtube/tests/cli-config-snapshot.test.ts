// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../src/cli.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeSecureConfig } from './helpers/config-files.js';

describe('CLI Config Snapshots', () => {
  let tempRoot: string;
  let configPath: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-config-snapshot-'));
    configPath = join(tempRoot, 'config.yaml');
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const createConfig = async () => {
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
    await writeSecureConfig(configPath, content);
  };

  const sanitize = (text: string) => {
    return text.replaceAll(tempRoot, '/tmp/aidha-test');
  };

  it('config show snapshot', async () => {
    await createConfig();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['config', 'show', '--config', configPath]);

    const output = sanitize(consoleLog.mock.calls.map(args => args[0]).join('\n'));
    expect(output).toMatchSnapshot();
  });

  it('config show --json snapshot', async () => {
    await createConfig();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['config', 'show', '--config', configPath, '--json']);

    const output = sanitize(consoleLog.mock.calls.map(args => args[0]).join('\n'));
    expect(output).toMatchSnapshot();
  });

  it('config explain snapshot', async () => {
    await createConfig();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['config', 'explain', 'llm.model', '--config', configPath]);

    const output = sanitize(consoleLog.mock.calls.map(args => args[0]).join('\n'));
    expect(output).toMatchSnapshot();
  });

  it('config explain source snapshot', async () => {
    await createConfig();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['config', 'explain', 'activeSourceConfig.ytdlp.timeout_ms', '--config', configPath, '--source', 'youtube']);

    const output = sanitize(consoleLog.mock.calls.map(args => args[0]).join('\n'));
    expect(output).toMatchSnapshot();
  });

  it('config list-profiles --json snapshot', async () => {
    await createConfig();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['config', 'list-profiles', '--config', configPath, '--json']);

    const output = sanitize(consoleLog.mock.calls.map(args => args[0]).join('\n'));
    expect(output).toMatchSnapshot();
  });

  it('config diff snapshot', async () => {
    await createConfig();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['config', 'diff', 'local', 'prod', '--config', configPath]);

    const output = sanitize(consoleLog.mock.calls.map(args => args[0]).join('\n'));
    expect(output).toMatchSnapshot();
  });
});
