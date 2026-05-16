import { describe, it, expect } from 'vitest';
import {
  SOURCE_ID,
  YouTubeSourceRegistration,
} from '../src/config/youtube-source-adapter.js';
import type { ResolvedYoutubeConfig } from '../src/config/youtube-source-adapter.js';

describe('YouTube source adapter', () => {
  it('should export a stable SOURCE_ID', () => {
    expect(SOURCE_ID).toBe('youtube');
  });

  it('should have registration matching SOURCE_ID', () => {
    expect(YouTubeSourceRegistration.sourceId).toBe('youtube');
  });

  it('should provide built-in defaults', () => {
    expect(YouTubeSourceRegistration.defaults).toBeDefined();
    const defaults = YouTubeSourceRegistration.defaults as Record<string, unknown>;
    const ytdlp = defaults.ytdlp as Record<string, unknown>;
    expect(ytdlp.bin).toBe('yt-dlp');
    expect(ytdlp.timeout_ms).toBe(120_000);
    const youtube = defaults.youtube as Record<string, unknown>;
    expect(youtube.cookie).toBe('');
  });

  it('should validate and narrow a complete activeSourceConfig', () => {
    const raw = {
      ytdlp: { bin: 'custom-bin', timeout_ms: 5000, cookies_file: '/tmp/cookies' },
      youtube: { cookie: 'secret-cookie', innertube_api_key: 'key', debug_transcript: true }, // pragma: allowlist secret
    };
    const validated = YouTubeSourceRegistration.validateActiveSourceConfig(raw);
    expect(validated.ytdlp.bin).toBe('custom-bin');
    expect(validated.ytdlp.timeoutMs).toBe(5000);
    expect(validated.ytdlp.cookiesFile).toBe('/tmp/cookies');
    expect(validated.youtube.cookie).toBe('secret-cookie');
    expect(validated.youtube.innertubeApiKey).toBe('key');
    expect(validated.youtube.debugTranscript).toBe(true);
  });

  it('should provide safe defaults for null/invalid input', () => {
    const validated = YouTubeSourceRegistration.validateActiveSourceConfig(null);
    expect(validated.ytdlp.bin).toBe('yt-dlp');
    expect(validated.ytdlp.timeoutMs).toBe(120_000);
    expect(validated.youtube.cookie).toBe('');
  });

  it('should provide safe defaults for partial input', () => {
    const raw = { ytdlp: { bin: 'my-bin' } };
    const validated = YouTubeSourceRegistration.validateActiveSourceConfig(raw);
    expect(validated.ytdlp.bin).toBe('my-bin');
    expect(validated.ytdlp.timeoutMs).toBe(120_000);
    expect(validated.youtube.debugTranscript).toBe(false);
  });

  it('should redact secrets', () => {
    const config: ResolvedYoutubeConfig = {
      ytdlp: { bin: 'yt-dlp', cookiesFile: '', remoteComponents: '', timeoutMs: 120000, jsRuntimes: '', keepFiles: false },
      youtube: { cookie: 'super-secret', innertubeApiKey: 'api-key', debugTranscript: false }, // pragma: allowlist secret
    };
    const redacted = YouTubeSourceRegistration.redactActiveSourceConfig?.(config) as Record<string, unknown>;
    const youtube = redacted.youtube as Record<string, unknown>;
    expect(youtube.cookie).toBe('********');
    expect(youtube.innertubeApiKey).toBe('********');
    expect(redacted.ytdlp).toEqual(config.ytdlp);
  });

  it('should not redact empty secrets', () => {
    const config: ResolvedYoutubeConfig = {
      ytdlp: { bin: 'yt-dlp', cookiesFile: '', remoteComponents: '', timeoutMs: 120000, jsRuntimes: '', keepFiles: false },
      youtube: { cookie: '', innertubeApiKey: '', debugTranscript: false },
    };
    const redacted = YouTubeSourceRegistration.redactActiveSourceConfig?.(config) as Record<string, unknown>;
    const youtube = redacted.youtube as Record<string, unknown>;
    expect(youtube.cookie).toBe('********');
    expect(youtube.innertubeApiKey).toBe('');
  });

  it('should resolve paths in source config', () => {
    const config: ResolvedYoutubeConfig = {
      ytdlp: { bin: '/usr/local/bin/yt-dlp', cookiesFile: './cookies.txt', remoteComponents: '', timeoutMs: 120000, jsRuntimes: '', keepFiles: false },
      youtube: { cookie: '', innertubeApiKey: '', debugTranscript: false },
    };
    const resolved = YouTubeSourceRegistration.resolveSourcePaths?.(config, '/project');
    expect(resolved?.ytdlp.bin).toBe('/usr/local/bin/yt-dlp');
    expect(resolved?.ytdlp.cookiesFile).toBe('/project/cookies.txt');
  });

  it('should not resolve bare command names', () => {
    const config: ResolvedYoutubeConfig = {
      ytdlp: { bin: 'yt-dlp', cookiesFile: '', remoteComponents: '', timeoutMs: 120000, jsRuntimes: '', keepFiles: false },
      youtube: { cookie: '', innertubeApiKey: '', debugTranscript: false },
    };
    const resolved = YouTubeSourceRegistration.resolveSourcePaths?.(config, '/project');
    expect(resolved?.ytdlp.bin).toBe('yt-dlp');
  });

  it('should have metadata for path fields, secrets, and explain labels', () => {
    expect(YouTubeSourceRegistration.metadata?.pathFields).toContain('ytdlp.cookies_file');
    expect(YouTubeSourceRegistration.metadata?.secretFields).toContain('youtube.cookie');
    expect(YouTubeSourceRegistration.metadata?.explainLabels?.['ytdlp.bin']).toBeDefined();
  });

  it('should have CLI bindings that auto-select youtube source', () => {
    const bindings = YouTubeSourceRegistration.cliBindings ?? [];
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every(b => b.selectsSourceByDefault)).toBe(true);
    expect(bindings.some(b => b.command === 'extract claims')).toBe(true);
  });
});
