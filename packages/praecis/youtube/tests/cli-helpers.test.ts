import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/parse.js';
import { formatIngestionStatus } from '../src/cli/status.js';

describe('CLI Parse Helper', () => {
  it('parses boolean options without consuming next token', () => {
    // --json is a known boolean flag. It should not consume 'positional'.
    const { options, positionals } = parseArgs(['--json', 'positional']);
    expect(options['json']).toBe(true);
    expect(positionals).toEqual(['positional']);
  });

  it('parses valued options correctly', () => {
    const { options, positionals } = parseArgs(['--config', 'file.yaml']);
    expect(options['config']).toBe('file.yaml');
    expect(positionals).toEqual([]);
  });

  it('parses dash-prefixed values if they follow a valued option', () => {
    // --out takes a value. Even if it starts with -, it should be consumed.
    const { options, positionals } = parseArgs(['--out', '-some-path']);
    expect(options['out']).toBe('-some-path');
    expect(positionals).toEqual([]);
  });

  it('stops parsing options after --', () => {
    const { options, positionals } = parseArgs(['--json', '--', '--config', 'file.yaml']);
    expect(options['json']).toBe(true);
    expect(options['config']).toBeUndefined();
    expect(positionals).toEqual(['--config', 'file.yaml']);
  });
});

describe('CLI Status Helper', () => {
  it('formats ingestion status correctly', () => {
    const status = {
      resourceId: 'test',
      transcriptStatus: 'available',
      transcriptLanguage: 'en',
      excerptCount: 2,
      claimCount: 5,
      referenceCount: 3,
    };

    const textOutput = formatIngestionStatus(status, { json: false });
    expect(textOutput).toContain('Status for test');
    expect(textOutput).toContain('Transcript: available (en)');
    expect(textOutput).toContain('Claims: 5');

    const jsonOutput = formatIngestionStatus(status, { json: true });
    expect(JSON.parse(jsonOutput).resourceId).toBe('test');
  });
});
