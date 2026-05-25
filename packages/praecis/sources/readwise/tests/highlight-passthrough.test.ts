import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@aidha/config';
import { createReadwiseVectorSpec } from '../src/index.js';

describe('createReadwiseVectorSpec', () => {
  it('maps highlights to external locators and keeps the web canonical id when source_url exists', async () => {
    const vector = createReadwiseVectorSpec({
      user_book_id: 11,
      title: 'How to Do What You Love',
      author: 'Paul Graham',
      source_url: 'https://example.com/article?utm_source=readwise',
      readwise_url: 'https://readwise.io/bookreview/11',
      highlights: [
        { id: 1, text: 'First quote', book_id: 11, note: 'note one', updated_at: '2026-05-22T00:00:00.000Z' },
        { id: 2, text: 'Second quote', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
      ],
    });

    const result = await vector.ingestAndDecode({ ref: 'readwise:book:11' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.raw.resourceMetadata).toMatchObject({
      title: 'How to Do What You Love',
      author: 'Paul Graham',
      canonicalUrl: 'https://example.com/article',
      sourceUrl: 'https://example.com/article?utm_source=readwise',
      readwiseUrl: 'https://readwise.io/bookreview/11',
      readwiseBookId: 11,
      highlightCount: 2,
    });
    expect(result.value.segments).toHaveLength(2);
    expect(result.value.segments[0]!.locator.kind).toBe('external');
    expect(result.value.segments[0]!.locator).toEqual({ kind: 'external', system: 'readwise', externalId: '1' });
    expect(result.value.segments[0]!.text).toBe('First quote');

    const context = await vector.context.build(result.value.raw, {} as ResolvedConfig);
    const chunkResult = await vector.chunking.chunk({ segments: result.value.segments, context });
    expect(chunkResult.ok).toBe(true);
    if (!chunkResult.ok) throw chunkResult.error;
    expect(chunkResult.value).toHaveLength(2);
    expect(chunkResult.value[0]!.text).toBe('First quote');
  });
});
