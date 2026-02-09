import { describe, expect, it } from 'vitest';
import { CLI_USAGE_TEXT } from '../src/cli/help.js';

describe('CLI usage help text', () => {
  it('documents query state filters', () => {
    expect(CLI_USAGE_TEXT).toContain('--states <accepted|draft|rejected>');
    expect(CLI_USAGE_TEXT).toContain('--include-rejected');
    expect(CLI_USAGE_TEXT).toContain('--include-drafts');
  });

  it('documents area, goal, and project helper commands', () => {
    expect(CLI_USAGE_TEXT).toContain('aidha-youtube area create --name "<name>"');
    expect(CLI_USAGE_TEXT).toContain('aidha-youtube goal create --name "<name>"');
    expect(CLI_USAGE_TEXT).toContain('aidha-youtube project create --name "<name>"');
  });

  it('documents split dossier and transcript export commands', () => {
    expect(CLI_USAGE_TEXT).toContain('export dossier video <videoIdOrUrl>');
    expect(CLI_USAGE_TEXT).toContain('--split-states');
    expect(CLI_USAGE_TEXT).toContain('export transcript video <videoIdOrUrl>');
  });

  it('documents yt-dlp JS runtime ingest option', () => {
    expect(CLI_USAGE_TEXT).toContain('--ytdlp-js-runtimes <list>');
    expect(CLI_USAGE_TEXT).toContain('preflight youtube');
    expect(CLI_USAGE_TEXT).toContain('--probe-url <url>');
    expect(CLI_USAGE_TEXT).toContain('fixtures import-ttml <path>');
    expect(CLI_USAGE_TEXT).toContain('claims purge <videoIdOrUrl>');
  });

  it('documents editorial extraction and diagnose flags', () => {
    expect(CLI_USAGE_TEXT).toContain('--editor-version <v1|v2>');
    expect(CLI_USAGE_TEXT).toContain('--window-minutes <n>');
    expect(CLI_USAGE_TEXT).toContain('--max-per-window <n>');
    expect(CLI_USAGE_TEXT).toContain('--min-windows <n>');
    expect(CLI_USAGE_TEXT).toContain('--min-words <n>');
    expect(CLI_USAGE_TEXT).toContain('--min-chars <n>');
    expect(CLI_USAGE_TEXT).toContain('--editor-llm');
    expect(CLI_USAGE_TEXT).toContain('diagnose editor <videoIdOrUrl>');
    expect(CLI_USAGE_TEXT).toContain('--include-editor');
  });
});
