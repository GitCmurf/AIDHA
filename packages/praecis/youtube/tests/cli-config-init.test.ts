import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../src/cli.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';

describe('CLI Config Init (Phase 2A)', () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aidha-cli-config-init-'));
    cwd = process.cwd();
    // Helper to spy on process.cwd() or chdir?
    // runCli doesn't change CWD, but init writes to CWD or user home.
    // For project-local, it writes to .aidha/config.yaml relative to CWD?
    // Implementation plan says --project-local writes to ./.aidha/config.yaml.
    // So we need to control CWD.
    // But we cannot easily change CWD of test runner safely if parallel.
    // We should pass CWD via options or mock process.cwd().
    // We can spy on process.cwd.
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('init (default/project-local) creates .aidha/config.yaml with 0600', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Default behavior might be user-global or project-local?
    // Plan says "Deterministic scaffold by default (CI-friendly)."
    // Usually init in repo implies project-local?
    // Let's assume default is project-local or user-global?
    // Plan says: --project-local (./.aidha/config.yaml) vs --user-global.
    // Let's test explicit flags first to be sure.

    const code = await runCli(['config', 'init', '--project-local']);
    expect(code).toBe(0);

    const configPath = join(tmpDir, '.aidha', 'config.yaml');
    const stats = await stat(configPath);
    // Check permissions: 0600 (rw-------)
    // Mode includes type. We mask with 0o777.
    // On Windows permissions are weird, but we are on Linux.
    expect(stats.mode & 0o777).toBe(0o600);

    // Check content
    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('config_version: 1');
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Initialized config'));
  });

  it('init fails if file exists without force', async () => {
    const configFile = join(tmpDir, '.aidha', 'config.yaml');
    await import('node:fs/promises').then(fs => fs.mkdir(join(tmpDir, '.aidha'), { recursive: true }));
    // use valid config to pass loadConfig validation
    await writeFile(configFile, 'config_version: 1\ndefault_profile: existing\nprofiles:\n  existing: {}');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runCli(['config', 'init', '--project-local']);
    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('init overwrites with --force', async () => {
    const configFile = join(tmpDir, '.aidha', 'config.yaml');
    await import('node:fs/promises').then(fs => fs.mkdir(join(tmpDir, '.aidha'), { recursive: true }));
    // use valid config
    await writeFile(configFile, 'config_version: 1\ndefault_profile: existing\nprofiles:\n  existing: {}');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'init', '--project-local', '--force']);
    expect(code).toBe(0);

    const content = await readFile(configFile, 'utf-8');
    expect(content).toContain('config_version: 1');
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Overwriting'));
  });

  it('init --dry-run prints preview without writing', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'init', '--project-local', '--dry-run']);
    expect(code).toBe(0);

    // File should not exist
    await expect(stat(join(tmpDir, '.aidha', 'config.yaml'))).rejects.toThrow();

    // Preview output
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('config_version: 1'));
    // Should NOT say "Initialized" or "Written" but maybe "Dry run:"
  });

  it('init --interactive requires TTY', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const code = await runCli(['config', 'init', '--interactive']);

    expect(code).toBe(0);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('non-interactive environment'));
  });
});
