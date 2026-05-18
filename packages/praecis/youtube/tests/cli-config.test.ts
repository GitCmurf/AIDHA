import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCliConfig, buildCliOverrides } from '../src/cli/config-bridge.js';
import { copySecureConfigSync, writeInsecureConfig, writeSecureConfigSync } from './helpers/config-files.js';
import { ConfigValidationError, InterpolationCycleError } from '@aidha/config';

describe('CLI Configuration Bridge', () => {
  const sourceFixturePath = resolve(__dirname, 'fixtures/config/aidha.yaml');
  let fixtureRoot: string;
  let fixturePath: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-config-fixture-'));
    fixturePath = join(fixtureRoot, 'aidha.yaml');
    copySecureConfigSync(sourceFixturePath, fixturePath);
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('resolves defaults when no options provided', async () => {
    // This looks for aidha.yaml in CWD, likely won't find it, so returns defaults
    const { config, youtubeConfig } = await resolveCliConfig({});
    expect(config.db).toBe(resolve(process.env['INIT_CWD'] || process.cwd(), './out/aidha.sqlite'));
    expect(youtubeConfig).toBeNull();
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
    const { config, youtubeConfig } = await resolveCliConfig({
      source: 'youtube', // Should trigger youtube defaults if any
    });
    expect(config).toBeDefined();
    expect(youtubeConfig).not.toBeNull();
    expect(youtubeConfig?.youtube.debugTranscript).toBe(false);
  });

  it('coerces quoted source override scalars for youtube config', async () => {
    const configPath = join(fixtureRoot, 'coerced-source-overrides.yaml');
    writeSecureConfigSync(configPath, [
      'config_version: 1',
      'default_profile: default',
      'profiles:',
      '  default:',
      '    source_overrides:',
      '      youtube:',
      '        ytdlp:',
      '          timeout_ms: "${YTDLP_TIMEOUT}"',
      '          keep_files: "true"',
      '        youtube:',
      '          cookie: ""',
      'sources:',
      '  youtube:',
      '    ytdlp:',
      '      bin: yt-dlp',
      '    youtube:',
      '      cookie: ""',
      '      innertube_api_key: ""',
      '      debug_transcript: false',
    ].join('\n'));

    const originalTimeout = process.env['YTDLP_TIMEOUT'];
    process.env['YTDLP_TIMEOUT'] = '45000';

    try {
      const result = await resolveCliConfig({
        configPath,
        source: 'youtube',
      });

      expect(result.ok).toBe(true);
      expect(result.youtubeConfig?.ytdlp.timeoutMs).toBe(45_000);
      expect(result.youtubeConfig?.ytdlp.keepFiles).toBe(true);
    } finally {
      if (originalTimeout === undefined) {
        delete process.env['YTDLP_TIMEOUT'];
      } else {
        process.env['YTDLP_TIMEOUT'] = originalTimeout;
      }
    }
  });

  it('applies profile source_overrides to the selected youtube source', async () => {
    const configPath = join(fixtureRoot, 'source-overrides.yaml');
    writeSecureConfigSync(configPath, [
      'config_version: 1',
      'default_profile: default',
      'profiles:',
      '  default:',
      '    db: ./default.sqlite',
      '  custom:',
      '    source_overrides:',
      '      youtube:',
      '        youtube:',
      '          debug_transcript: true',
      'sources:',
      '  youtube:',
      '    ytdlp:',
      '      bin: yt-dlp',
      '    youtube:',
      '      cookie: ""',
      '      innertube_api_key: ""',
      '      debug_transcript: false',
    ].join('\n'));

    const result = await resolveCliConfig({
      configPath,
      source: 'youtube',
      profile: 'custom',
    });

    expect(result.ok).toBe(true);
    expect(result.youtubeConfig).not.toBeNull();
    expect(result.youtubeConfig?.youtube.debugTranscript).toBe(true);
  });

  it('returns a config-validation failure for invalid core source_overrides', async () => {
    const configPath = join(fixtureRoot, 'invalid-source-overrides.yaml');
    writeSecureConfigSync(configPath, [
      'config_version: 1',
      'default_profile: production',
      'profiles:',
      '  production:',
      '    source_overrides:',
      '      youtube:',
      '        extraction:',
      '          max_claims: many',
      'sources:',
      '  youtube:',
      '    ytdlp:',
      '      bin: yt-dlp',
      '    youtube:',
      '      cookie: ""',
      '      innertube_api_key: ""',
      '      debug_transcript: false',
    ].join('\n'));

    const result = await resolveCliConfig({
      configPath,
      source: 'youtube',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(ConfigValidationError);
    expect(result.error.message).toContain('/profiles/production/source_overrides/youtube/extraction/max_claims');
    expect(result.error).toEqual(expect.objectContaining({
      errors: expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('/profiles/production/source_overrides/youtube/extraction/max_claims'),
        }),
      ]),
    }));
  });

  it('returns a config-domain failure for interpolation cycles', async () => {
    const configPath = join(fixtureRoot, 'interpolation-cycle.yaml');
    writeSecureConfigSync(configPath, [
      'config_version: 1',
      'default_profile: local',
      'profiles:',
      '  local:',
      '    llm:',
      '      model: gpt-5-mini',
      '      api_key: ${A}',
    ].join('\n'));

    const originalA = process.env['A'];
    const originalB = process.env['B'];
    process.env['A'] = '${B}';
    process.env['B'] = '${A}';

    try {
      const result = await resolveCliConfig({
        configPath,
        profile: 'local',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(InterpolationCycleError);
      expect(result.error.message).toContain('Circular env-var reference detected');
    } finally {
      if (originalA === undefined) {
        delete process.env['A'];
      } else {
        process.env['A'] = originalA;
      }
      if (originalB === undefined) {
        delete process.env['B'];
      } else {
        process.env['B'] = originalB;
      }
    }
  });

  it('resolves activeSourceConfig paths before inspection commands read them', async () => {
    const configPath = join(fixtureRoot, 'source-paths.yaml');
    writeSecureConfigSync(configPath, [
      'config_version: 1',
      'default_profile: default',
      'profiles:',
      '  default:',
      '    source_overrides:',
      '      youtube:',
      '        ytdlp:',
      '          cookies_file: ./cookies.txt',
      'sources:',
      '  youtube:',
      '    ytdlp:',
      '      bin: yt-dlp',
      '    youtube:',
      '      cookie: ""',
      '      innertube_api_key: ""',
      '      debug_transcript: false',
    ].join('\n'));

    const result = await resolveCliConfig({
      configPath,
      source: 'youtube',
    });

    expect(result.ok).toBe(true);
    const expectedCookiesPath = resolve(fixtureRoot, './cookies.txt');
    const activeSourceConfig = result.config.activeSourceConfig as { ytdlp?: { cookies_file?: string } };

    expect(activeSourceConfig?.ytdlp?.cookies_file).toBe(expectedCookiesPath);
    expect(result.youtubeConfig?.ytdlp.cookiesFile).toBe(expectedCookiesPath);
  });

  it('does not warn for secure explicit config permissions', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveCliConfig({ configPath: fixturePath });

    expect(result.ok).toBe(true);
    expect(consoleWarn).not.toHaveBeenCalledWith(expect.stringContaining('expected 0600'));
    consoleWarn.mockRestore();
  });

  it('warns for insecure explicit config permissions without mutating the file', async () => {
    const insecurePath = join(fixtureRoot, 'insecure.yaml');
    await writeInsecureConfig(insecurePath, [
      'config_version: 1',
      'default_profile: local',
      'profiles:',
      '  local: {}',
    ].join('\n'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveCliConfig({ configPath: insecurePath });

    expect(result.ok).toBe(true);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('expected 0600'));
    expect(statSync(insecurePath).mode & 0o777).toBe(0o644);
    consoleWarn.mockRestore();
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

  it('does NOT sync configured dotenv values into process.env', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-config-'));
    const configPath = join(tempRoot, '.aidha', 'config.yaml');
    const dotenvPath = join(tempRoot, '.env');
    const originalOpenAiKey = process.env['AIDHA_OPENAI_API_KEY'];
    const originalGoogleKey = process.env['AIDHA_GOOGLE_API_KEY'];

    try {
      mkdirSync(join(tempRoot, '.aidha'), { recursive: true });
      writeSecureConfigSync(configPath, [
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
      // Should NOT be in process.env now
      expect(process.env['AIDHA_OPENAI_API_KEY']).toBeUndefined();
      expect(process.env['AIDHA_GOOGLE_API_KEY']).toBeUndefined();
      // dotenvEnv should carry the loaded keys for later scoped injection
      expect(result.loadResult.dotenvEnv['AIDHA_OPENAI_API_KEY']).toBe('from-dotenv-openai');
      expect(result.loadResult.dotenvEnv['AIDHA_GOOGLE_API_KEY']).toBe('from-dotenv-google');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      if (originalOpenAiKey === undefined) delete process.env['AIDHA_OPENAI_API_KEY'];
      else process.env['AIDHA_OPENAI_API_KEY'] = originalOpenAiKey;
      if (originalGoogleKey === undefined) delete process.env['AIDHA_GOOGLE_API_KEY'];
      else process.env['AIDHA_GOOGLE_API_KEY'] = originalGoogleKey;
    }
  });

  it('validates strictly positive embedding-batch-size override', () => {
    const overrides0 = buildCliOverrides({ 'embedding-batch-size': '0' });
    expect(overrides0.llm?.embedding_batch_size).toBeUndefined();

    const overridesNeg = buildCliOverrides({ 'embedding-batch-size': '-5' });
    expect(overridesNeg.llm?.embedding_batch_size).toBeUndefined();

    const overridesPos = buildCliOverrides({ 'embedding-batch-size': '10' });
    expect(overridesPos.llm?.embedding_batch_size).toBe(10);
  });

  it('returns empty dotenvEnv when no dotenv files are configured', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-dotenv-env-'));
    try {
      mkdirSync(join(tempRoot, '.aidha'), { recursive: true });
      writeSecureConfigSync(join(tempRoot, '.aidha', 'config.yaml'), [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        '    llm:',
        '      model: no-dotenv-model',
      ].join('\n'));

      const result = await resolveCliConfig({ configPath: join(tempRoot, '.aidha', 'config.yaml') });
      expect(result.ok).toBe(true);
      expect(result.loadResult.dotenvEnv).toEqual({});
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('includes dotenv overrides in dotenvEnv when override_existing is true and shell has stale value', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-override-'));
    const configPath = join(tempRoot, '.aidha', 'config.yaml');
    const dotenvPath = join(tempRoot, '.env');
    const originalKey = process.env['AIDHA_OPENAI_API_KEY'];

    try {
      mkdirSync(join(tempRoot, '.aidha'), { recursive: true });
      writeSecureConfigSync(configPath, [
        'config_version: 1',
        'default_profile: default',
        'env:',
        '  dotenv_files:',
        '    - .env',
        '  override_existing: true',
        'profiles:',
        '  default:',
        '    llm:',
        '      model: gpt-5-mini',
        '      api_key: ${AIDHA_OPENAI_API_KEY}',
      ].join('\n'));
      writeFileSync(dotenvPath, [
        'AIDHA_OPENAI_API_KEY=from-dotenv-override',
      ].join('\n'));

      process.env['AIDHA_OPENAI_API_KEY'] = 'stale-shell-value'; // pragma: allowlist secret

      const result = await resolveCliConfig({ configPath });
      expect(result.ok).toBe(true);
      expect(result.config.llm.apiKey).toBe('from-dotenv-override');
      expect(result.loadResult.dotenvEnv['AIDHA_OPENAI_API_KEY']).toBe('from-dotenv-override');

      const dotenvEnv = result.loadResult.dotenvEnv;
      const injectedKeys: string[] = [];
      const savedOriginals: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(dotenvEnv)) {
        if (process.env[key] !== value) {
          savedOriginals[key] = process.env[key];
          process.env[key] = value;
          injectedKeys.push(key);
        }
      }
      try {
        expect(process.env['AIDHA_OPENAI_API_KEY']).toBe('from-dotenv-override');
      } finally {
        for (const key of injectedKeys) {
          if (savedOriginals[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = savedOriginals[key];
          }
        }
      }
      expect(process.env['AIDHA_OPENAI_API_KEY']).toBe('stale-shell-value');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      if (originalKey === undefined) delete process.env['AIDHA_OPENAI_API_KEY'];
      else process.env['AIDHA_OPENAI_API_KEY'] = originalKey;
    }
  });

  it('uses INIT_CWD for project-local config discovery', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aidha-cli-init-cwd-'));
    const originalInitCwd = process.env['INIT_CWD'];

    try {
      mkdirSync(join(tempRoot, '.aidha'), { recursive: true });
      writeSecureConfigSync(join(tempRoot, '.aidha', 'config.yaml'), [
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
