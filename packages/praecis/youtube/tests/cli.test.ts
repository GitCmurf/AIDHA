/**
 * CLI parsing tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/parse.js';

describe('parseArgs', () => {
  it('parses positionals and flags', () => {
    const result = parseArgs([
      'ingest',
      'playlist',
      'PL123',
      '--db',
      './out/aidha.sqlite',
      '--ytdlp-timeout',
      '180000',
      '--json',
      '--mock',
    ]);

    expect(result.positionals).toEqual(['ingest', 'playlist', 'PL123']);
    expect(result.options.db).toBe('./out/aidha.sqlite');
    expect(result.options['ytdlp-timeout']).toBe('180000');
    expect(result.options.json).toBe(true);
    expect(result.options.mock).toBe(true);
  });
});
