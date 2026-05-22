import { describe, expect, it } from 'vitest';
import { runReadwiseBatch } from '../src/index.js';

describe('runReadwiseBatch', () => {
  it('keeps source_url items on the shared web identity and falls back to readwise book ids otherwise', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          count: 2,
          nextPageCursor: null,
          results: [
            {
              user_book_id: 11,
              title: 'Shared article',
              author: 'Author',
              source_url: 'https://example.com/article?utm_source=readwise',
              readwise_url: 'https://readwise.io/bookreview/11',
              highlights: [
                { id: 1, text: 'Alpha', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
                { id: 2, text: 'Beta', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
              ],
            },
            {
              user_book_id: 22,
              title: 'Manual quote',
              highlights: [
                { id: 3, text: 'Gamma', book_id: 22, updated_at: '2026-05-22T00:00:00.000Z' },
              ],
            },
          ],
        };
      },
    });

    const result = await runReadwiseBatch({ token: 'token-123', fetchFn });

    expect(result.totalBooks).toBe(2);
    expect(result.summaries[0]!.canonicalId).toBe('web:https://example.com/article');
    expect(result.summaries[0]!.segmentCount).toBe(2);
    expect(result.summaries[0]!.segments[0]!.locator).toEqual({ kind: 'external', system: 'readwise', externalId: '1' });
    expect(result.summaries[1]!.canonicalId).toBe('readwise:book:22');
  });
});
