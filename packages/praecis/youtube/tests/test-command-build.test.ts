// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  name: string;
  scripts: Record<string, string>;
};

function runCommand(mode: string, buildExitCode: number, selector = '') {
  const directory = mkdtempSync(join(tmpdir(), 'aidha-test-command-'));
  const log = join(directory, 'commands.jsonl');
  const stub = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const program = path.basename(process.argv[1]);',
    "if (program === 'pnpm' && process.argv[2] === 'run') {",
    "  const manifest = JSON.parse(fs.readFileSync(process.env.PACKAGE_MANIFEST, 'utf8'));",
    "  const command = manifest.scripts[process.argv[3]];",
    "  if (typeof command !== 'string') process.exit(2);",
    "  const result = require('node:child_process').spawnSync('/bin/sh', ['-c', command], { env: process.env, stdio: 'inherit' });",
    "  if (result.error) throw result.error;",
    "  process.exit(result.status ?? 1);",
    "}",
    "fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ program, args: process.argv.slice(2) }) + '\\n');",
    "process.exit(program === 'pnpm' ? Number(process.env.BUILD_EXIT_CODE) : 0);",
    '',
  ].join('\n');
  try {
    for (const program of ['pnpm', 'vitest']) {
      writeFileSync(join(directory, program), stub, { mode: 0o755 });
    }
    const command = packageJson.scripts[mode];
    if (!command) throw new Error(`Missing test command: ${mode}`);
    const result = spawnSync('/bin/sh', ['-c', `${command} ${selector}`], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        PATH: `${directory}${delimiter}${dirname(process.execPath)}${delimiter}${process.env['PATH'] ?? ''}`,
        COMMAND_LOG: log,
        PACKAGE_MANIFEST: manifestPath,
        BUILD_EXIT_CODE: String(buildExitCode),
      },
    });
    const commands = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line =>
      JSON.parse(line) as { program: string; args: string[] }) : [];
    return { result, commands };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.each(['test', 'test:ci', 'test:full', 'test:watch'])('%s build prerequisite', mode => {
  it('builds before starting the test runner', () => {
    const { result, commands } = runCommand(mode, 0);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(commands.map(command => command.program)).toEqual(['pnpm', 'vitest']);
    expect(commands[0]?.args).toEqual(['--filter', `${packageJson.name}...`, '--fail-if-no-match', 'build']);
    const runnerArgs: Record<string, string[]> = {
      test: ['run'], 'test:ci': ['run', '--silent', '--reporter=dot'],
      'test:full': ['run'], 'test:watch': [],
    };
    expect(commands[1]?.args).toEqual(runnerArgs[mode]);
  }, 20000);

  it('propagates build failure without starting the test runner', () => {
    const { result, commands } = runCommand(mode, 23);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(23);
    expect(commands.map(command => command.program)).toEqual(['pnpm']);
  }, 20000);

  it('forwards a selected test only to the test runner', () => {
    const selector = 'tests/cli-memory-database.test.ts';
    const { result, commands } = runCommand(mode, 0, selector);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.args).not.toContain(selector);
    expect(commands[1]?.args).toContain(selector);
  }, 20000);
});
