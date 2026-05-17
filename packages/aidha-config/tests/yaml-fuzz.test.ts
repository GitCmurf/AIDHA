import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseConfigYaml, ConfigParseError } from '../src/parser.js';

describe('YAML parser safety bounds', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidha-yaml-fuzz-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should reject config files exceeding MAX_DOCUMENT_SIZE', () => {
    const bigPath = join(tmpDir, 'big.yaml');
    const content = 'config_version: 1\nprofiles: {}\ndefault_profile: default\n' + 'x: ' + 'a'.repeat(1_048_576) + '\n';
    writeFileSync(bigPath, content, 'utf-8');

    expect(() => parseConfigYaml(bigPath)).toThrow(ConfigParseError);
    try {
      parseConfigYaml(bigPath);
    } catch (e) {
      expect((e as ConfigParseError).message).toContain('maximum size');
    }
  });

  it('should reject YAML alias bombs', () => {
    const bombPath = join(tmpDir, 'bomb.yaml');
    const content = 'config_version: 1\ndefault_profile: default\nprofiles:\n  default: &default\n    db: test\n  copy: *default\n';
    for (let i = 0; i < 10; i++) {
      writeFileSync(bombPath, content, 'utf-8');
    }
    expect(() => parseConfigYaml(bombPath)).not.toThrow();
  });

  it('should reject malformed YAML', () => {
    const badPath = join(tmpDir, 'bad.yaml');
    writeFileSync(badPath, '{ invalid yaml: [', 'utf-8');
    expect(() => parseConfigYaml(badPath)).toThrow(ConfigParseError);
  });

  it('should reject empty files', () => {
    const emptyPath = join(tmpDir, 'empty.yaml');
    writeFileSync(emptyPath, '', 'utf-8');
    expect(() => parseConfigYaml(emptyPath)).toThrow(ConfigParseError);
  });

  it('should reject non-object YAML', () => {
    const strPath = join(tmpDir, 'string.yaml');
    writeFileSync(strPath, 'just a string', 'utf-8');
    expect(() => parseConfigYaml(strPath)).toThrow(ConfigParseError);
  });
});

describe('Dotenv safety guardrails', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidha-dotenv-safety-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should skip symlink dotenv files', async () => {
    const { symlink, writeFileSync: ws } = await import('node:fs');
    const dotenvPath = join(tmpDir, 'real.env');
    const linkPath = join(tmpDir, 'link.env');
    ws(dotenvPath, 'KEY=value\n', 'utf-8');
    try {
      symlink(dotenvPath, linkPath);
    } catch {
      return;
    }

    const warnings: string[] = [];
    const { loadDotenvFiles } = await import('../src/dotenv.js');
    const env: Record<string, string | undefined> = {};
    loadDotenvFiles({
      files: ['link.env'],
      baseDir: tmpDir,
      env,
      overrideExisting: true,
      required: false,
      syncProcessEnv: false,
      onWarning: (msg) => warnings.push(msg),
    });
    expect(warnings.some((w) => w.includes('symlink'))).toBe(true);
    expect(env['KEY']).toBeUndefined();
  });

  it('should skip dotenv files outside the base directory', async () => {
    const warnings: string[] = [];
    const { loadDotenvFiles } = await import('../src/dotenv.js');
    const env: Record<string, string | undefined> = {};
    loadDotenvFiles({
      files: ['../../etc/passwd'],
      baseDir: tmpDir,
      env,
      overrideExisting: true,
      required: false,
      syncProcessEnv: false,
      onWarning: (msg) => warnings.push(msg),
    });
    expect(warnings.some((w) => w.includes('outside'))).toBe(true);
  });
});
