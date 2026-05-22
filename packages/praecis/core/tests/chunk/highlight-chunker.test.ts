import { describe, expect, it } from 'vitest';
import { HighlightChunker } from '../../src/chunk/highlight-chunker.js';

describe('HighlightChunker', () => {
  it('returns one chunk per highlight segment', async () => {
    const chunker = new HighlightChunker();
    const result = await chunker.chunk({
      context: {},
      segments: [
        { id: 'h1', locator: { kind: 'external', system: 'readwise', externalId: 'rw-1' }, text: 'First highlight' },
        { id: 'h2', locator: { kind: 'external', system: 'readwise', externalId: 'rw-2' }, text: 'Second highlight' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.text).toBe('First highlight');
    expect(result.value[1]!.locator.kind).toBe('external');
  });
});
