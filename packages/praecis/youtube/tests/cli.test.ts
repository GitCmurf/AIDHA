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
      '--ytdlp-js-runtimes',
      'node',
      '--editor-version',
      'v2',
      '--window-minutes',
      '5',
      '--max-per-window',
      '2',
      '--min-windows',
      '3',
      '--min-words',
      '8',
      '--min-chars',
      '50',
      '--editor-llm',
      '--json',
      '--mock',
    ]);

    expect(result.positionals).toEqual(['ingest', 'playlist', 'PL123']);
    expect(result.options.db).toBe('./out/aidha.sqlite');
    expect(result.options['ytdlp-timeout']).toBe('180000');
    expect(result.options['ytdlp-js-runtimes']).toBe('node');
    expect(result.options['editor-version']).toBe('v2');
    expect(result.options['window-minutes']).toBe('5');
    expect(result.options['max-per-window']).toBe('2');
    expect(result.options['min-windows']).toBe('3');
    expect(result.options['min-words']).toBe('8');
    expect(result.options['min-chars']).toBe('50');
    expect(result.options['editor-llm']).toBe(true);
    expect(result.options.json).toBe(true);
    expect(result.options.mock).toBe(true);
  });
});
