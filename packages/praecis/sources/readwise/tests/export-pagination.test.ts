import { describe, expect, it } from 'vitest';
import { fetchReadwiseExport } from '../src/index.js';

describe('fetchReadwiseExport', () => {
  it('pages through export results and preserves updatedAfter on the first request', async () => {
    const seenUrls: string[] = [];
    const seenHeaders: Array<Record<string, string> | undefined> = [];

    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrls.push(url);
      seenHeaders.push(init?.headers);

      if (seenUrls.length === 1) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              count: 2,
              nextPageCursor: 'cursor-2',
              results: [
                {
                  user_book_id: 101,
                  title: 'First book',
                  source_url: 'https://example.com/article',
                  highlights: [
                    { id: 1, text: 'First highlight', book_id: 101, updated_at: '2026-05-22T00:00:00.000Z' },
                  ],
                },
              ],
            };
          },
        };
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            count: 2,
            nextPageCursor: null,
            results: [
              {
                user_book_id: 202,
                title: 'Second book',
                highlights: [
                  { id: 2, text: 'Second highlight', book_id: 202, updated_at: '2026-05-22T00:00:00.000Z' },
                ],
              },
            ],
          };
        },
      };
    };

    const results = await fetchReadwiseExport({
      token: 'token-123',
      updatedAfter: '2026-05-01T00:00:00Z',
      fetchFn,
    });

    expect(results).toHaveLength(2);
    expect(seenUrls[0]).toContain('updatedAfter=2026-05-01T00%3A00%3A00Z');
    expect(seenUrls[0]).not.toContain('pageCursor=');
    expect(seenUrls[1]).toContain('pageCursor=cursor-2');
    expect(seenHeaders[0]?.Authorization).toBe('Token token-123');
  });
});
