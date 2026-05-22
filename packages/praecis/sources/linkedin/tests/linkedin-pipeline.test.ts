import { describe, expect, it } from 'vitest';
import { createLinkedInVectorSpec } from '../src/index.js';

describe('LinkedIn paste pipeline', () => {
  it('emits text locators for pasted paragraphs', async () => {
    const vector = createLinkedInVectorSpec({
      pasteText: 'First paragraph.\n\nSecond paragraph.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
    });

    const result = await vector.ingestAndDecode({ ref: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value.raw.sourceType).toBe('linkedin');
    expect(result.value.segments).toHaveLength(2);
    expect(result.value.segments[0]!.locator).toEqual({ kind: 'text', charStart: 0, charEnd: 'First paragraph.'.length });
    expect(result.value.segments[0]!.text).toBe('First paragraph.');
    expect(result.value.segments[1]!.locator.kind).toBe('text');
  });
});
