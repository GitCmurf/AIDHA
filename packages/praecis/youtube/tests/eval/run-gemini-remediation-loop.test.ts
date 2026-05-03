import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../../..');
const scriptPath = resolve(repoRoot, 'scripts/eval-matrix/run-gemini-remediation-loop.sh');

let tempRoot = '';

async function writeExecutable(filePath: string, body: string) {
  await writeFile(filePath, body, 'utf-8');
  await chmod(filePath, 0o755);
}

async function createStubBin(name: string, body: string) {
  const filePath = resolve(tempRoot, name);
  await writeExecutable(filePath, body);
  return filePath;
}

function runLoop(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe('run-gemini-remediation-loop.sh', () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  it('rejects flags with missing values before shifting', async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), 'aidha-remediation-loop-'));
    const result = runLoop(['--review-file'], {
      ...process.env,
      PATH: `${tempRoot}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--review-file requires a value.');
    expect(result.stderr).not.toContain('shift');
  });

  it('fails fast when the quick verification build fails', async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), 'aidha-remediation-loop-'));
    const commandLog = resolve(tempRoot, 'commands.log');
    const reviewFile = resolve(tempRoot, 'review.txt');

    await createStubBin('gemini', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'gemini %s\\n' "$*" >> "${commandLog}"`,
      "printf '%s\\n' 'Gemini summary.'",
      'exit 0',
    ].join('\n'));

    await createStubBin('pnpm', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'pnpm %s\\n' "$*" >> "${commandLog}"`,
      'if [[ "${1:-}" == "--dir" ]]; then',
      '    shift 2',
      '    case "${1:-}" in',
      '        build)',
      '            printf "%s\\n" "build failed" >&2',
      '            exit 23',
      '            ;;',
      '        exec)',
      '            if [[ "${2:-}" == "vitest" && "${3:-}" == "run" ]]; then',
      '                printf "%s\\n" "vitest passed"',
      '                exit 0',
      '            fi',
      '            ;;',
      '        run)',
      '            if [[ "${1:-}" == "docs:build" ]]; then',
      '                printf "%s\\n" "docs build failed" >&2',
      '                exit 31',
      '            fi',
      '            ;;',
      '    esac',
      'fi',
      'exit 0',
    ].join('\n'));

    await createStubBin('coderabbit', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'coderabbit %s\\n' "$*" >> "${commandLog}"`,
      'if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then',
      '    exit 0',
      'fi',
      'if [[ "${1:-}" == "review" ]]; then',
      "    printf '%s\\n' 'No issues found.'",
      '    exit 0',
      'fi',
      'exit 0',
    ].join('\n'));

    await createStubBin('timeout', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'args=()',
      'seen_command=false',
      'for arg in "$@"; do',
      '    if [[ "${seen_command}" == "false" ]]; then',
      '        case "$arg" in',
      '            --foreground|--preserve-status)',
      '                continue',
      '                ;;',
      '            --signal=*|--kill-after=*)',
      '                continue',
      '                ;;',
      '            [0-9]*s)',
      '                seen_command=true',
      '                continue',
      '                ;;',
      '        esac',
      '    fi',
      '    seen_command=true',
      '    args+=("$arg")',
      'done',
      'exec "${args[@]}"',
    ].join('\n'));

    await writeFile(reviewFile, [
      '[P1] Preserve configured OpenAI base URLs',
      'The patch should keep using the configured base URL.',
    ].join('\n'), 'utf-8');

    const result = runLoop([
      '--review-file', reviewFile,
      '--verify-mode', 'quick',
      '--review-tool', 'coderabbit',
      '--max-iterations', '1',
      '--heartbeat-seconds', '1',
      '--hard-timeout-minutes', '1',
    ], {
      ...process.env,
      PATH: `${tempRoot}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(23);
    expect(result.stdout).toContain('build failed');
    expect(result.stdout).not.toContain('No issues found.');

    const logText = await readFile(commandLog, 'utf-8');
    expect(logText).toContain('gemini ');
    expect(logText).toContain('pnpm --dir');
    expect(logText).not.toContain('coderabbit ');
  }, 30000);

  it('accepts a clean structured codex review as clear', async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), 'aidha-remediation-loop-'));
    const commandLog = resolve(tempRoot, 'commands.log');
    const reviewFile = resolve(tempRoot, 'review.txt');

    await createStubBin('gemini', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'gemini %s\\n' "$*" >> "${commandLog}"`,
      "printf '%s\\n' 'Gemini summary.'",
      'exit 0',
    ].join('\n'));

    await createStubBin('pnpm', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'pnpm %s\\n' "$*" >> "${commandLog}"`,
      'if [[ "${1:-}" == "--dir" ]]; then',
      '    shift 2',
      '    case "${1:-}" in',
      '        build)',
      '            printf "%s\\n" "build passed"',
      '            exit 0',
      '            ;;',
      '        exec)',
      '            if [[ "${2:-}" == "vitest" && "${3:-}" == "run" ]]; then',
      '                printf "%s\\n" "vitest passed"',
      '                exit 0',
      '            fi',
      '            ;;',
      '    esac',
      'fi',
      'exit 0',
    ].join('\n'));

    await createStubBin('codex', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'codex %s\\n' "$*" >> "${commandLog}"`,
      'if [[ "${1:-}" == "review" ]]; then',
      "    printf '%s\\n' '{\"findings\":[],\"overall_correctness\":\"patch is correct\"}'",
      '    exit 0',
      'fi',
      'exit 0',
    ].join('\n'));

    await createStubBin('timeout', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'args=()',
      'seen_command=false',
      'for arg in "$@"; do',
      '    if [[ "${seen_command}" == "false" ]]; then',
      '        case "$arg" in',
      '            --foreground|--preserve-status)',
      '                continue',
      '                ;;',
      '            --signal=*|--kill-after=*)',
      '                continue',
      '                ;;',
      '            [0-9]*s)',
      '                seen_command=true',
      '                continue',
      '                ;;',
      '        esac',
      '    fi',
      '    seen_command=true',
      '    args+=("$arg")',
      'done',
      'exec "${args[@]}"',
    ].join('\n'));

    await writeFile(reviewFile, [
      '[P1] Preserve configured OpenAI base URLs',
      'The patch should keep using the configured base URL.',
    ].join('\n'), 'utf-8');

    const result = runLoop([
      '--review-file', reviewFile,
      '--verify-mode', 'quick',
      '--review-tool', 'codex',
      '--max-iterations', '1',
      '--heartbeat-seconds', '1',
      '--hard-timeout-minutes', '1',
    ], {
      ...process.env,
      PATH: `${tempRoot}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('{"findings":[],"overall_correctness":"patch is correct"}');
    expect(result.stderr).toContain('review looks clear');

    const logText = await readFile(commandLog, 'utf-8');
    expect(logText).toContain('codex review');
    expect(logText).not.toContain('coderabbit ');
  }, 30000);

  it('fails fast when docs verification fails in full mode', async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), 'aidha-remediation-loop-'));
    const commandLog = resolve(tempRoot, 'commands.log');
    const reviewFile = resolve(tempRoot, 'review.txt');

    await createStubBin('gemini', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'gemini %s\\n' "$*" >> "${commandLog}"`,
      "printf '%s\\n' 'Gemini summary.'",
      'exit 0',
    ].join('\n'));

    await createStubBin('pnpm', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'pnpm %s\\n' "$*" >> "${commandLog}"`,
      'if [[ "${1:-}" == "--dir" ]]; then',
      '    shift 2',
      '    case "${1:-}" in',
      '        build)',
      '            printf "%s\\n" "build passed"',
      '            exit 0',
      '            ;;',
      '        exec)',
      '            if [[ "${2:-}" == "vitest" && "${3:-}" == "run" ]]; then',
      '                printf "%s\\n" "vitest passed"',
      '                exit 0',
      '            fi',
      '            ;;',
      '        run)',
      '            if [[ "${2:-}" == "docs:build" ]]; then',
      '                printf "%s\\n" "docs build failed" >&2',
      '                exit 31',
      '            fi',
      '            ;;',
      '    esac',
      'fi',
      'exit 0',
    ].join('\n'));

    await createStubBin('coderabbit', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'coderabbit %s\\n' "$*" >> "${commandLog}"`,
      'if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then',
      '    exit 0',
      'fi',
      'if [[ "${1:-}" == "review" ]]; then',
      "    printf '%s\\n' 'No issues found.'",
      '    exit 0',
      'fi',
      'exit 0',
    ].join('\n'));

    await createStubBin('timeout', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'args=()',
      'seen_command=false',
      'for arg in "$@"; do',
      '    if [[ "${seen_command}" == "false" ]]; then',
      '        case "$arg" in',
      '            --foreground|--preserve-status)',
      '                continue',
      '                ;;',
      '            --signal=*|--kill-after=*)',
      '                continue',
      '                ;;',
      '            [0-9]*s)',
      '                seen_command=true',
      '                continue',
      '                ;;',
      '        esac',
      '    fi',
      '    seen_command=true',
      '    args+=("$arg")',
      'done',
      'exec "${args[@]}"',
    ].join('\n'));

    await writeFile(reviewFile, [
      '[P1] Propagate verification failures before continuing',
      'The loop must stop if the docs build fails.',
    ].join('\n'), 'utf-8');

    const result = runLoop([
      '--review-file', reviewFile,
      '--verify-mode', 'full',
      '--review-tool', 'coderabbit',
      '--max-iterations', '1',
      '--heartbeat-seconds', '1',
      '--hard-timeout-minutes', '1',
    ], {
      ...process.env,
      PATH: `${tempRoot}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(31);
    expect(result.stdout).toContain('docs build failed');
    expect(result.stdout).not.toContain('No issues found.');

    const logText = await readFile(commandLog, 'utf-8');
    expect(logText).toContain('pnpm --dir');
    expect(logText).not.toContain('coderabbit ');
  }, 45000);
});
