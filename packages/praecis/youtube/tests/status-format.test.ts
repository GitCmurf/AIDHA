import { describe, it, expect } from 'vitest';
import { formatIngestionStatus } from '../src/cli/status.js';

describe('formatIngestionStatus', () => {
  const status = {
    videoId: 'test-video',
    resourceId: 'youtube-test-video',
    transcriptStatus: 'available',
    transcriptLanguage: 'en',
    transcriptError: undefined,
    excerptCount: 3,
    claimCount: 5,
    referenceCount: 1,
  };

  it('formats human-readable output', () => {
    const output = formatIngestionStatus(status);
    expect(output).toContain('Status for youtube-test-video');
    expect(output).toContain('Transcript: available (en)');
    expect(output).toContain('Excerpts: 3');
    expect(output).toContain('Claims: 5');
    expect(output).toContain('References: 1');
  });

  it('formats json output', () => {
    const output = formatIngestionStatus(status, { json: true });
    const parsed = JSON.parse(output) as typeof status;
    expect(parsed.resourceId).toBe('youtube-test-video');
    expect(parsed.claimCount).toBe(5);
  });
});
