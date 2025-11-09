import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYAML } from 'yaml';
import {
  writeConfig,
  ConfigReadOnlyError,
  ConfigConflictError,
  ConfigWriteValidationError,
} from '../src/writer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aidha-writer-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const validConfig = {
  config_version: 1,
  default_profile: 'default',
  profiles: { default: { db: './test.sqlite' } },
};

function configPath(): string {
  return join(tmpDir, 'config.yaml');
}

describe('writeConfig — basic functionality', () => {
  it('should write a valid config file', () => {
    const result = writeConfig({ filePath: configPath(), config: validConfig });
    expect(result.written).toBe(true);
    expect(existsSync(configPath())).toBe(true);

    const content = readFileSync(configPath(), 'utf-8');
    expect(content).toContain('config_version: 1');
    expect(content).toContain('default_profile: default');
  });

  it('should produce valid YAML output', () => {
    writeConfig({ filePath: configPath(), config: validConfig });
    const content = readFileSync(configPath(), 'utf-8');
    const parsed = parseYAML(content);
    expect(parsed.config_version).toBe(1);
  });
});

describe('writeConfig — validation', () => {
  it('should throw ConfigWriteValidationError for invalid config', () => {
    const invalid = { ...validConfig, unknown_key: 'bad' };
    expect(() =>
      writeConfig({ filePath: configPath(), config: invalid }),
    ).toThrow(ConfigWriteValidationError);
  });

  it('should skip validation when skipValidation is true', () => {
    const invalid = { ...validConfig, unknown_key: 'bad' };
    const result = writeConfig({
      filePath: configPath(),
      config: invalid,
      skipValidation: true,
    });
    expect(result.written).toBe(true);
  });
});

describe('writeConfig — dry run', () => {
  it('should not write in dry-run mode', () => {
    const result = writeConfig({
      filePath: configPath(),
      config: validConfig,
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(existsSync(configPath())).toBe(false);
  });

  it('should return validation errors in dry-run mode', () => {
    const invalid = { ...validConfig, unknown_key: 'bad' };
    const result = writeConfig({
      filePath: configPath(),
      config: invalid,
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});

describe('writeConfig — read-only mode', () => {
  it('should throw ConfigReadOnlyError when AIDHA_CONFIG_READONLY=1', () => {
    expect(() =>
      writeConfig({
        filePath: configPath(),
        config: validConfig,
        env: { AIDHA_CONFIG_READONLY: '1' },
      }),
    ).toThrow(ConfigReadOnlyError);
  });

  it('should allow writes when AIDHA_CONFIG_READONLY is not set', () => {
    const result = writeConfig({
      filePath: configPath(),
      config: validConfig,
      env: {},
    });
    expect(result.written).toBe(true);
  });
});

describe('writeConfig — backup rotation', () => {
  it('should create a .bak backup when overwriting', () => {
    writeFileSync(configPath(), 'old content');
    writeConfig({ filePath: configPath(), config: validConfig, env: {} });

    const bakPath = configPath() + '.bak';
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, 'utf-8')).toBe('old content');
  });

  it('should rotate backups (bak → bak.1)', () => {
    writeFileSync(configPath(), 'version-1');
    writeConfig({ filePath: configPath(), config: validConfig, env: {} });

    // Overwrite with new content to trigger another backup
    writeFileSync(configPath(), 'version-2');
    writeConfig({ filePath: configPath(), config: validConfig, env: {} });

    expect(existsSync(configPath() + '.bak')).toBe(true);
    expect(existsSync(configPath() + '.bak.1')).toBe(true);
    // .bak should contain latest pre-write content
    expect(readFileSync(configPath() + '.bak', 'utf-8')).toBe('version-2');
    // .bak.1 should contain rotated content from previous .bak
    expect(readFileSync(configPath() + '.bak.1', 'utf-8')).toBe('version-1');
  });

  it('should not create backup when no previous file exists', () => {
    writeConfig({ filePath: configPath(), config: validConfig, env: {} });
    const bakPath = configPath() + '.bak';
    expect(existsSync(bakPath)).toBe(false);
  });
});

describe('writeConfig — concurrency guard', () => {
  it('should not throw when expectedMtime is provided but the file does not exist', () => {
    const result = writeConfig({
      filePath: configPath(),
      config: validConfig,
      expectedMtime: 123,
      env: {},
    });
    expect(result.written).toBe(true);
  });

  it('should throw ConfigConflictError when file changes after initial check', async () => {
    // Use a module-mocked fs.writeFileSync to simulate a concurrent edit after
    // the initial mtime check but before the final rename.
    writeFileSync(configPath(), 'original');
    const { mtimeMs } = statSync(configPath());

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        writeFileSync: (path: any, data: any, options?: any) => {
          // When the writer is creating its temp file, mutate the target file
          // to bump its mtime and trigger the pre-rename recheck.
          if (typeof path === 'string' && path.includes('.tmp.')) {
            actual.writeFileSync(configPath(), 'concurrent-change');
            // Ensure the mtime differs by more than the default tolerance.
            const bumped = new Date(mtimeMs + 5000);
            actual.utimesSync(configPath(), bumped, bumped);
          }
          return actual.writeFileSync(path as any, data as any, options as any);
        },
      };
    });

    try {
      const { writeConfig: mockedWriteConfig, ConfigConflictError: CErr } = await import(
        '../src/writer.js'
      );
      expect(() =>
        mockedWriteConfig({
          filePath: configPath(),
          config: validConfig,
          expectedMtime: mtimeMs,
          env: {},
        }),
      ).toThrow(CErr);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('should throw ConfigConflictError when mtime mismatch', () => {
    writeFileSync(configPath(), 'original');
    expect(() =>
      writeConfig({
        filePath: configPath(),
        config: validConfig,
        expectedMtime: 0, // Ancient mtime — will mismatch
        env: {},
      }),
    ).toThrow(ConfigConflictError);
  });

  it('should allow write when mtime matches', () => {
    writeFileSync(configPath(), 'original');
    const { mtimeMs } = statSync(configPath());

    const result = writeConfig({
      filePath: configPath(),
      config: validConfig,
      expectedMtime: mtimeMs,
      env: {},
    });
    expect(result.written).toBe(true);
  });
});
