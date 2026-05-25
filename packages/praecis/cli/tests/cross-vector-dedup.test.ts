import { describe, expect, it } from 'vitest';
import { composeVector, createDefaultPipelineServices, createPipelineRuntime } from '@aidha/praecis-core';
import { createRssVectorSpec } from '@aidha/praecis-source-feeds';
import { createReadwiseVectorSpec } from '@aidha/praecis-source-readwise';

function makeFetchResponse(url: string, text: string) {
  return {
    ok: true,
    url,
    status: 200,
    async text() {
      return text;
    },
  };
}

describe('cross-vector dedup integration', () => {
  it('merges RSS and Readwise when both resolve to the same web canonical id', async () => {
    const services = createDefaultPipelineServices({ allowHeuristicFallback: true });
    const runtime = createPipelineRuntime(services);
    runtime.register(composeVector(createRssVectorSpec(async url => {
      if (url === 'https://blog.example.com/feed.xml') {
        return makeFetchResponse(url, '<?xml version="1.0"?><rss><channel><item><guid>item-1</guid><title>Article</title><link>https://example.com/article?utm_source=rss</link><description>Summary text for the feed item.</description></item></channel></rss>');
      }
      return makeFetchResponse(url, '<html><body><article><p>Shared article has a specific claim for export.</p></article></body></html>');
    })));
    runtime.register(createReadwiseVectorSpec({
      user_book_id: 7,
      title: 'Article',
      source_url: 'https://example.com/article?utm_source=readwise',
      highlights: [{ id: 1, text: 'Shared article has a specific claim for export.', book_id: 7, updated_at: '2026-05-22T00:00:00.000Z' }],
    }));

    const rss = await runtime.run('rss', { ref: 'https://blog.example.com/feed.xml', metadata: { itemGuid: 'item-1' } });
    const readwise = await runtime.run('readwise', { ref: 'readwise:book:7' });

    expect(rss.ok).toBe(true);
    expect(readwise.ok).toBe(true);
    if (!rss.ok) throw rss.error;
    if (!readwise.ok) throw readwise.error;
    expect(rss.value.resourceId).toBe('web:https://example.com/article');
    expect(readwise.value.dedupAction).toBe('merge');
    expect(readwise.value.resourceId).toBe(rss.value.resourceId);
  });

  it('links but does not merge Readwise books without source_url', async () => {
    const services = createDefaultPipelineServices({ allowHeuristicFallback: true });
    const runtime = createPipelineRuntime(services);
    runtime.register(createReadwiseVectorSpec({
      user_book_id: 8,
      title: 'Book only',
      highlights: [{ id: 2, text: 'A standalone highlight remains book scoped.', book_id: 8, updated_at: '2026-05-22T00:00:00.000Z' }],
    }));

    const result = await runtime.run('readwise', { ref: 'readwise:book:8' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.resourceId).toBe('readwise:book:8');
    expect(result.value.dedupAction).toBe('create');
  });
});
