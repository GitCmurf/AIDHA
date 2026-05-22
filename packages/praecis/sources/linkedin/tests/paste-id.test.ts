import { describe, expect, it } from 'vitest';
import { createLinkedInVectorSpec } from '../src/index.js';

describe('LinkedIn paste bridge identity', () => {
  it('derives canonical ids from activity urn urls when present', async () => {
    const vector = createLinkedInVectorSpec({
      pasteText: 'Hello LinkedIn\n\nThis is a paste bridge test.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
    });

    const result = await vector.ingestAndDecode({ ref: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value.raw.canonicalId).toBe('linkedin:urn:li:activity:1234567890');
    expect(result.value.raw.dedupKeys).toContain('urn:li:activity:1234567890');
  });

  it('falls back to a pasted-text hash when no url is present', async () => {
    const vector = createLinkedInVectorSpec({
      pasteText: 'Plain paste with no URL',
    });

    const result = await vector.ingestAndDecode({ ref: 'stdin' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value.raw.canonicalId.startsWith('linkedin:')).toBe(true);
    expect(result.value.raw.canonicalId).not.toContain('urn:li:activity:');
  });
});
