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
  });
});
