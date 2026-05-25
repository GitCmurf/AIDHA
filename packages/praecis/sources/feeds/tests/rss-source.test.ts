// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { composeVector } from '@aidha/praecis-core';
import { RssIngestor, RssTextDecodeStrategy, createRssVectorSpec } from '../src/index.js';

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First item</title>
      <link>https://Example.com/article?utm_source=rss</link>
      <guid>guid-1</guid>
      <description>Short summary only.</description>
      <category>Technology</category>
      <pubDate>Wed, 21 May 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second item</title>
      <guid>guid-2</guid>
      <description>Another summary.</description>
    </item>
  </channel>
</rss>`;

const articleHtml = '<html><head><title>Article title</title></head><body><h1>Article title</h1><p>Body text</p></body></html>';

function makeFetch() {
  return async (url: string) => {
    if (url.includes('feed.xml')) {
      return {
        ok: true,
        url,
        status: 200,
        async text() {
          return feedXml;
        },
      };
    }
    if (url.includes('article')) {
      return {
        ok: true,
        url: 'https://example.com/article',
        status: 200,
        async text() {
          return articleHtml;
        },
      };
    }
    return {
      ok: false,
      url,
      status: 404,
      async text() {
        return 'not found';
      },
    };
  };
}

describe('RssIngestor', () => {
  it('selects the requested item guid', async () => {
    const ingestor = new RssIngestor({ fetchFn: makeFetch() });
    const result = await ingestor.acquire({ ref: 'https://example.com/feed.xml', metadata: { itemGuid: 'guid-2' } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.label).toBe('Second item');
    expect(result.value.canonicalId).toBe('rss:https://example.com/feed.xml#guid-2');
  });

  it('uses the article canonical URL when a link is present', async () => {
    const ingestor = new RssIngestor({ fetchFn: makeFetch() });
    const result = await ingestor.acquire({ ref: 'https://example.com/feed.xml' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.dedupKeys).toContain('guid-1');
    expect(result.value.dedupKeys).toContain('https://example.com/article');
    expect(result.value.payload.articleHtml).toContain('Article title');
    expect(result.value.resourceMetadata).toMatchObject({
      title: 'First item',
      feedTitle: 'Example Feed',
      feedUrl: 'https://example.com/feed.xml',
      itemGuid: 'guid-1',
      articleUrl: 'https://Example.com/article?utm_source=rss',
      canonicalUrl: 'https://example.com/article',
      categories: ['Technology'],
    });
  });
});

describe('RssTextDecodeStrategy', () => {
  it('decodes feed item HTML into text segments', async () => {
    const strategy = new RssTextDecodeStrategy();
    const result = await strategy.decode({
      raw: {
        canonicalId: 'web:https://example.com/article',
        sourceType: 'rss',
        sensitivity: 'public',
        provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'rss' },
        payload: {
          feedUrl: 'https://example.com/feed.xml',
          feedTitle: 'Example Feed',
          item: {
            title: 'First item',
            link: 'https://example.com/article',
            guid: 'guid-1',
            description: 'Short summary only.',
            contentHtml: articleHtml,
            categories: ['Technology'],
          },
          articleHtml,
        },
        label: 'First item',
      },
      config: {} as Parameters<RssTextDecodeStrategy['decode']>[0]['config'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments).toHaveLength(3);
  });
});

describe('createRssVectorSpec', () => {
  it('builds a composed rss vector that fetches full text when needed', async () => {
    const vector = composeVector(createRssVectorSpec(makeFetch()));
    const result = await vector.ingestAndDecode({ ref: 'https://example.com/feed.xml' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.segments.length).toBeGreaterThan(0);
  });
});
