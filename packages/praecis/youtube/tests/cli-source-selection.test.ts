import { describe, expect, it } from 'vitest';
import { resolveSourceId } from '../src/cli.js';

describe('resolveSourceId', () => {
  it('prefers explicit --source when provided', () => {
    const source = resolveSourceId(['query', 'test'], { source: 'custom-source' });
    expect(source).toBe('custom-source');
  });

  it('defaults to youtube for package CLI commands', () => {
    expect(resolveSourceId(['ingest', 'video'], {})).toBe('youtube');
    expect(resolveSourceId(['extract', 'claims'], {})).toBe('youtube');
    expect(resolveSourceId(['claims', 'purge'], {})).toBe('youtube');
    expect(resolveSourceId(['export', 'dossier'], {})).toBe('youtube');
    expect(resolveSourceId(['query', 'text'], {})).toBe('youtube');
    expect(resolveSourceId(['related'], {})).toBe('youtube');
    expect(resolveSourceId(['review', 'next'], {})).toBe('youtube');
    expect(resolveSourceId(['task', 'create'], {})).toBe('youtube');
    expect(resolveSourceId(['area', 'create'], {})).toBe('youtube');
    expect(resolveSourceId(['goal', 'create'], {})).toBe('youtube');
    expect(resolveSourceId(['project', 'create'], {})).toBe('youtube');
    expect(resolveSourceId(['diagnose', 'stats'], {})).toBe('youtube');
    expect(resolveSourceId(['preflight', 'youtube'], {})).toBe('youtube');
    expect(resolveSourceId(['fixtures', 'import-ttml'], {})).toBe('youtube');
  });
});
