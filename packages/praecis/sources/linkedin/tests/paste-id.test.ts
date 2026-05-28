import { describe, expect, it } from 'vitest';
import { createLinkedInVectorSpec } from '../src/index.js';
import type { ResolvedConfig } from '@aidha/config';

const runtimeContext = {
  config: {} as ResolvedConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

describe('LinkedIn paste bridge identity', () => {
  it('derives canonical ids from activity urn urls when present', async () => {
    const vector = createLinkedInVectorSpec({
      pasteText: 'Hello LinkedIn\n\nThis is a paste bridge test.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
    });

    const result = await vector.ingestAndDecode({ ref: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/' }, runtimeContext);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value.raw.canonicalId).toBe('linkedin:urn:li:activity:1234567890');
    expect(result.value.raw.dedupKeys).toContain('urn:li:activity:1234567890');
    expect(result.value.raw.resourceMetadata).toMatchObject({
      activityUrn: 'urn:li:activity:1234567890',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
      paragraphCount: 2,
    });
    expect(result.value.raw.resourceMetadata?.['contentHash']).toEqual(expect.any(String));
  });

  it('falls back to a pasted-text hash when no url is present', async () => {
    const vector = createLinkedInVectorSpec({
      pasteText: 'Plain paste with no URL',
    });

    const result = await vector.ingestAndDecode({ ref: 'stdin' }, runtimeContext);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value.raw.canonicalId.startsWith('linkedin:')).toBe(true);
    expect(result.value.raw.canonicalId).not.toContain('urn:li:activity:');
  });
});
