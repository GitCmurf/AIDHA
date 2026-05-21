// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { composeVector } from '@aidha/praecis-core';
import { WebIngestor, WebTextDecodeStrategy, createWebVectorSpec, buildWebResourceId } from '../src/index.js';

function makeFetch(html: string, url = 'https://Example.com/article?utm_source=rss') {
  return async () => ({
    ok: true,
    url,
    status: 200,
    async text() {
      return html;
    },
  });
}

describe('WebIngestor', () => {
  it('acquires canonical web payloads with deterministic identities', async () => {
    const ingestor = new WebIngestor({ fetchFn: makeFetch('<title>Example title</title><p>Hello</p>') });
    const result = await ingestor.acquire({ ref: 'https://example.com/article?utm_source=rss' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.dedupKeys).toContain('https://Example.com/article?utm_source=rss');
    expect(result.value.payload.text).toBe('Example title\n\nHello');
  });
});

describe('WebTextDecodeStrategy', () => {
  it('decodes HTML payloads into text segments', async () => {
    const strategy = new WebTextDecodeStrategy();
    const result = await strategy.decode({
      raw: {
        canonicalId: 'web:https://example.com/article',
        sourceType: 'web',
        sensitivity: 'public',
        provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'web' },
        payload: {
          url: 'https://example.com/article',
          canonicalUrl: 'https://example.com/article',
          title: 'Example title',
          html: '<h1>Example title</h1><p>Hello world</p>',
          text: 'Example title\n\nHello world',
        },
        label: 'Example title',
      },
      config: {} as Parameters<WebTextDecodeStrategy['decode']>[0]['config'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments).toHaveLength(2);
  });
});

describe('createWebVectorSpec', () => {
  it('builds a composed vector that works end-to-end', async () => {
    const vector = composeVector(createWebVectorSpec(makeFetch('<title>Vector title</title><p>Body</p>')));
    const result = await vector.ingestAndDecode({ ref: 'https://example.com/article?utm_source=rss' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.segments.length).toBeGreaterThan(0);
  });
});

describe('buildWebResourceId', () => {
  it('uses the shared canonicalizer', () => {
    expect(buildWebResourceId('https://Example.com/article?utm_source=rss')).toBe('web:https://example.com/article');
  });
});
