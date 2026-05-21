// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { HttpWebFetcher } from '../src/index.js';

function makeResponse(ok: boolean, url: string, status: number, html: string) {
  return {
    ok,
    url,
    status,
    async text() {
      return html;
    },
  };
}

describe('HttpWebFetcher', () => {
  it('returns canonical URL, title, and html', async () => {
    const fetcher = new HttpWebFetcher(async () =>
      makeResponse(true, 'https://Example.com/article?utm_source=rss', 200, '<title>Article title</title><p>Hello</p>')
    );

    const result = await fetcher.fetch({ url: 'https://example.com/article?utm_source=rss' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.url).toBe('https://Example.com/article?utm_source=rss');
    expect(result.value.canonicalUrl).toBe('https://example.com/article');
    expect(result.value.title).toBe('Article title');
    expect(result.value.html).toContain('Hello');
  });

  it('falls back to the resolved URL when title is missing', async () => {
    const fetcher = new HttpWebFetcher(async () =>
      makeResponse(true, 'https://example.com/article', 200, '<p>No title</p>')
    );

    const result = await fetcher.fetch({ url: 'https://example.com/article' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.title).toBe('https://example.com/article');
  });

  it('returns a failure result for non-OK responses', async () => {
    const fetcher = new HttpWebFetcher(async () =>
      makeResponse(false, 'https://example.com/missing', 404, 'not found')
    );

    const result = await fetcher.fetch({ url: 'https://example.com/missing' });
    expect(result.ok).toBe(false);
  });
});
