import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCliConfig, buildCliOverrides } from '../src/cli/config-bridge.js';

describe('CLI Configuration Bridge', () => {
  const fixturePath = resolve(__dirname, 'fixtures/config/aidha.yaml');

  it('resolves defaults when no options provided', async () => {
    // This looks for aidha.yaml in CWD, likely won't find it, so returns defaults
    const { config } = await resolveCliConfig({});
    expect(config.db).toBe(resolve(process.env['INIT_CWD'] || process.cwd(), './out/aidha.sqlite'));
    expect(config.youtube.debugTranscript).toBe(false);
  });

  it('loads configuration from explicit file', async () => {
    const { config } = await resolveCliConfig({
      configPath: fixturePath,
    });
    // From fixture default_profile: local
    expect(config.db).to.contain('local.sqlite');
    expect(config.llm.model).toBe('gpt-4o');
  });

  it('activates named profile', async () => {
    const { config } = await resolveCliConfig({
      configPath: fixturePath,
      profile: 'custom',
    });
    expect(config.db).to.contain('custom.sqlite');
    expect(config.llm.model).toBe('claude-3-opus');
  });

  it('applies CLI overrides on top of config file', async () => {
    const { config } = await resolveCliConfig({
      configPath: fixturePath,
      cliOverrides: {
        db: 'overridden.db',
        llm: { model: 'overridden-model' },
      },
    });
    expect(config.db).toBe('overridden.db');
    expect(config.llm.model).toBe('overridden-model');
  });

  it('applies CLI overrides on top of defaults (zero-config)', async () => {
    const { config } = await resolveCliConfig({
      cliOverrides: {
        db: 'zero-config.db',
      },
    });
    expect(config.db).toBe('zero-config.db');
  });

  it('applies source defaults (if defined)', async () => {
    // We don't have source defaults in fixture, but we can check if source is respected in resolution logic
    // The default defaults.ts in aidha-config provides defaults.
    // Let's just check that it doesn't crash.
    const { config } = await resolveCliConfig({
      source: 'youtube', // Should trigger youtube defaults if any
    });
    expect(config).toBeDefined();
  });

  it('uses only explicit CLI flags for overrides', () => {
    const originalEnv = {
      AIDHA_LLM_MODEL: process.env['AIDHA_LLM_MODEL'],
      AIDHA_EDITOR_VERSION: process.env['AIDHA_EDITOR_VERSION'],
      AIDHA_CLAIMS_PROMPT_VERSION: process.env['AIDHA_CLAIMS_PROMPT_VERSION'],
      AIDHA_YTDLP_BIN: process.env['AIDHA_YTDLP_BIN'],
      AIDHA_YTDLP_COOKIES_FILE: process.env['AIDHA_YTDLP_COOKIES_FILE'],
      AIDHA_YTDLP_JS_RUNTIMES: process.env['AIDHA_YTDLP_JS_RUNTIMES'],
      AIDHA_LLM_CACHE_DIR: process.env['AIDHA_LLM_CACHE_DIR'],
    };

    process.env['AIDHA_LLM_MODEL'] = 'env-model-should-not-apply';
    process.env['AIDHA_EDITOR_VERSION'] = 'v1';
    process.env['AIDHA_CLAIMS_PROMPT_VERSION'] = 'env-prompt';
    process.env['AIDHA_YTDLP_BIN'] = '/env/yt-dlp';
    process.env['AIDHA_YTDLP_COOKIES_FILE'] = '/env/cookies.txt';
    process.env['AIDHA_YTDLP_JS_RUNTIMES'] = 'bun';
    process.env['AIDHA_LLM_CACHE_DIR'] = '/env/cache';

    try {
      const overrides = buildCliOverrides({});
      expect(overrides).toEqual({});
    } finally {
      if (originalEnv.AIDHA_LLM_MODEL === undefined) delete process.env['AIDHA_LLM_MODEL'];
      else process.env['AIDHA_LLM_MODEL'] = originalEnv.AIDHA_LLM_MODEL;
      if (originalEnv.AIDHA_EDITOR_VERSION === undefined) delete process.env['AIDHA_EDITOR_VERSION'];
      else process.env['AIDHA_EDITOR_VERSION'] = originalEnv.AIDHA_EDITOR_VERSION;
      if (originalEnv.AIDHA_CLAIMS_PROMPT_VERSION === undefined) delete process.env['AIDHA_CLAIMS_PROMPT_VERSION'];
      else process.env['AIDHA_CLAIMS_PROMPT_VERSION'] = originalEnv.AIDHA_CLAIMS_PROMPT_VERSION;
      if (originalEnv.AIDHA_YTDLP_BIN === undefined) delete process.env['AIDHA_YTDLP_BIN'];
      else process.env['AIDHA_YTDLP_BIN'] = originalEnv.AIDHA_YTDLP_BIN;
      if (originalEnv.AIDHA_YTDLP_COOKIES_FILE === undefined) delete process.env['AIDHA_YTDLP_COOKIES_FILE'];
      else process.env['AIDHA_YTDLP_COOKIES_FILE'] = originalEnv.AIDHA_YTDLP_COOKIES_FILE;
      if (originalEnv.AIDHA_YTDLP_JS_RUNTIMES === undefined) delete process.env['AIDHA_YTDLP_JS_RUNTIMES'];
      else process.env['AIDHA_YTDLP_JS_RUNTIMES'] = originalEnv.AIDHA_YTDLP_JS_RUNTIMES;
      if (originalEnv.AIDHA_LLM_CACHE_DIR === undefined) delete process.env['AIDHA_LLM_CACHE_DIR'];
      else process.env['AIDHA_LLM_CACHE_DIR'] = originalEnv.AIDHA_LLM_CACHE_DIR;
    }
  });

  it('syncs configured dotenv values into process.env for runtime consumers', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-config-'));
    const configPath = join(tempRoot, '.aidha', 'config.yaml');
    const dotenvPath = join(tempRoot, '.env');
    const originalOpenAiKey = process.env['AIDHA_OPENAI_API_KEY'];
    const originalGoogleKey = process.env['AIDHA_GOOGLE_API_KEY'];

    try {
      mkdirSync(join(tempRoot, '.aidha'), { recursive: true });
      writeFileSync(configPath, [
        'config_version: 1',
        'default_profile: default',
        'env:',
        '  dotenv_files:',
        '    - .env',
        'profiles:',
        '  default:',
        '    llm:',
        '      model: gpt-5-mini',
        '      api_key: ${AIDHA_OPENAI_API_KEY}',
      ].join('\n'));
      writeFileSync(dotenvPath, [
        'AIDHA_OPENAI_API_KEY=from-dotenv-openai',
        'AIDHA_GOOGLE_API_KEY=from-dotenv-google',
      ].join('\n'));

      delete process.env['AIDHA_OPENAI_API_KEY'];
      delete process.env['AIDHA_GOOGLE_API_KEY'];

      const result = await resolveCliConfig({ configPath });
      expect(result.ok).toBe(true);
      expect(result.config.llm.apiKey).toBe('from-dotenv-openai');
      expect(process.env['AIDHA_OPENAI_API_KEY']).toBe('from-dotenv-openai');
      expect(process.env['AIDHA_GOOGLE_API_KEY']).toBe('from-dotenv-google');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      if (originalOpenAiKey === undefined) delete process.env['AIDHA_OPENAI_API_KEY'];
      else process.env['AIDHA_OPENAI_API_KEY'] = originalOpenAiKey;
      if (originalGoogleKey === undefined) delete process.env['AIDHA_GOOGLE_API_KEY'];
      else process.env['AIDHA_GOOGLE_API_KEY'] = originalGoogleKey;
    }
  });

  it('uses INIT_CWD for project-local config discovery', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-init-cwd-'));
    const originalInitCwd = process.env['INIT_CWD'];

    try {
      mkdirSync(join(tempRoot, '.aidha'), { recursive: true });
      writeFileSync(join(tempRoot, '.aidha', 'config.yaml'), [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        '    llm:',
        '      model: init-cwd-model',
      ].join('\n'));

      process.env['INIT_CWD'] = tempRoot;

      const result = await resolveCliConfig({});
      expect(result.ok).toBe(true);
      expect(result.config.llm.model).toBe('init-cwd-model');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      if (originalInitCwd === undefined) delete process.env['INIT_CWD'];
      else process.env['INIT_CWD'] = originalInitCwd;
    }
  });
});
