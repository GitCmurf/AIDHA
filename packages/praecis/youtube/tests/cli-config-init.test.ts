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
    expect(content).not.toContain('temperature'); // Removed invalid key
    expect(content).toContain('cookie: ${YOUTUBE_COOKIE}'); // Renamed key
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

  it('init --source rss scaffolds source-specific config', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'init', '--source', 'rss', '--project-local']);
    expect(code).toBe(0);

    const configPath = join(tmpDir, '.aidha', 'config.yaml');
    const content = await readFile(configPath, 'utf-8');

    // Parse YAML to ensure structure is correct
    const { load } = await import('js-yaml');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = load(content) as any;

    expect(parsed.sources).toBeDefined();
    expect(parsed.sources.rss).toBeDefined();
    expect(parsed.sources.rss.poll_interval_minutes).toBe(60);

    // Profile 'local' should not have 'rss'
    expect(parsed.profiles.local.rss).toBeUndefined();
  });

  it('init --source youtube scaffolds source-specific config', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['config', 'init', '--source', 'youtube', '--project-local']);
    expect(code).toBe(0);

    const configPath = join(tmpDir, '.aidha', 'config.yaml');
    const content = await readFile(configPath, 'utf-8');

    const { load } = await import('js-yaml');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = load(content) as any;

    expect(parsed.sources).toBeDefined();
    expect(parsed.sources.youtube).toBeDefined();
    expect(parsed.sources.youtube.cookie).toBe('${YOUTUBE_COOKIE}');

    // Profile 'local' should not have 'youtube'
    expect(parsed.profiles.local.youtube).toBeUndefined();
  });

  it('init --user-global respects XDG_CONFIG_HOME', async () => {
    const xdgDir = join(tmpDir, 'xdg-config-home');
    const oldXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = xdgDir;
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const code = await runCli(['config', 'init', '--user-global', '--dry-run']);
      expect(code).toBe(0);
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(join(xdgDir, 'aidha', 'config.yaml')));
    } finally {
      if (oldXdg === undefined) {
        delete process.env['XDG_CONFIG_HOME'];
      } else {
        process.env['XDG_CONFIG_HOME'] = oldXdg;
      }
    }
  });

  it('init --user-global ignores relative XDG_CONFIG_HOME values', async () => {
    const oldXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = 'relative-xdg-home';
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const code = await runCli(['config', 'init', '--user-global', '--dry-run']);
      expect(code).toBe(0);
      expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('relative-xdg-home'));
    } finally {
      if (oldXdg === undefined) {
        delete process.env['XDG_CONFIG_HOME'];
      } else {
        process.env['XDG_CONFIG_HOME'] = oldXdg;
      }
    }
  });
});
