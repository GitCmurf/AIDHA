import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli, sanitizeErrorMessage } from '../src/cli.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as readline from 'node:readline';

// Auto-mock readline module
vi.mock('node:readline');

describe('CLI Config Security (Phase 2A)', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aidha-cli-config-secrets-'));
    configPath = join(tmpDir, 'config.yaml');
    // Create config with secrets
    await writeFile(configPath, `
config_version: 1
default_profile: secret
profiles:
  secret:
    llm:
      api_key: sk-12345
      model: gpt-4
`);
    // Default mock behavior
    vi.mocked(readline.createInterface).mockReturnValue({
      question: vi.fn(),
      close: vi.fn(),
    } as any);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('AT-215: show redacts secrets by default', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'show', '--config', configPath]);

    expect(code).toBe(0);
    const output = consoleLog.mock.calls[0][0];

    // Check redaction
    expect(output).toContain("'********'");
    // Check secret leakage
    expect(output).not.toContain('sk-12345');
  });

  it('AT-217: show --show-secrets requires --yes in non-TTY', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli(['config', 'show', '--show-secrets', '--config', configPath]);

    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('requires --yes'));
  });

  it('AT-217: show --show-secrets --yes reveals secrets in non-TTY', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli(['config', 'show', '--show-secrets', '--yes', '--config', configPath]);

    expect(code).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('sk-12345'));
  });

  it('AT-216: show --show-secrets in TTY asks for confirmation (User Accepts)', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    // Mock user input 'y'
    const mockRl = {
      question: vi.fn((q, cb) => cb('y')),
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const code = await runCli(['config', 'show', '--show-secrets', '--config', configPath]);

    expect(code).toBe(0);
    expect(mockRl.question).toHaveBeenCalledWith(expect.stringContaining('expose sensitive data'), expect.any(Function));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('sk-12345'));
  });

  it('AT-216: show --show-secrets in TTY asks for confirmation (User Denies)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    // Mock user input 'n'
    const mockRl = {
      question: vi.fn((q, cb) => cb('n')),
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const code = await runCli(['config', 'show', '--show-secrets', '--config', configPath]);

    expect(code).toBe(1);
    expect(mockRl.question).toHaveBeenCalledWith(expect.stringContaining('expose sensitive data'), expect.any(Function));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Aborted'));
  });

  it('redacts JSON-formatted secrets in error messages', () => {
    const sanitized = sanitizeErrorMessage('{"api_key":"sk-12345","authorization":"Bearer abc.def"}');
    expect(sanitized).not.toContain('sk-12345');
    expect(sanitized).not.toContain('Bearer abc.def');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('redacts unquoted Authorization bearer values', () => {
    const sanitized = sanitizeErrorMessage('Authorization: Bearer abc.def.ghi');
    expect(sanitized).not.toContain('abc.def.ghi');
    expect(sanitized).toContain('[REDACTED]');
  });
});
