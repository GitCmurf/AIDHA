// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { WebIngestor, WebTextDecodeStrategy, createWebVectorSpec, buildWebResourceId } from '../src/index.js';
import type { ResolvedConfig } from '@aidha/config';

const runtimeContext = {
  config: {} as ResolvedConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

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
    const result = await ingestor.acquire({ ref: 'https://example.com/article?utm_source=rss' }, runtimeContext);

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.dedupKeys).toContain('https://Example.com/article?utm_source=rss');
    expect(result.value.payload.text).toBe('Example title\n\nHello');
    expect(result.value.resourceMetadata).toMatchObject({
      title: 'Example title',
      canonicalUrl: 'https://example.com/article',
      resolvedUrl: 'https://Example.com/article?utm_source=rss',
      siteName: 'example.com',
    });
  });

  it('uses an injected clock for durable provenance timestamps', async () => {
    const ingestor = new WebIngestor({
      fetchFn: makeFetch('<title>Example title</title><p>Hello</p>'),
    });
    const first = await ingestor.acquire({ ref: 'https://example.com/article' }, runtimeContext);
    const second = await ingestor.acquire({ ref: 'https://example.com/article' }, runtimeContext);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected acquisitions to succeed');
    expect(first.value.provenance.ingestedAt).toBe('2026-05-25T12:34:56.000Z');
    expect(second.value.provenance).toEqual(first.value.provenance);
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
          resolvedCanonicalUrl: 'https://example.com/article',
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
    const vector = createWebVectorSpec({ fetchFn: makeFetch('<title>Vector title</title><p>Body</p>') });
    const result = await vector.ingestAndDecode({ ref: 'https://example.com/article?utm_source=rss' }, runtimeContext);

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('web:https://example.com/article');
    expect(result.value.segments.length).toBeGreaterThan(0);
  });

  it('keeps the primary web id fetch-independent when a request redirects', async () => {
    const vector = createWebVectorSpec({ fetchFn: makeFetch(
      '<title>Redirect</title><p>Redirected body text with enough detail.</p>',
      'https://cdn.example.com/final',
    ) });
    const result = await vector.ingestAndDecode({ ref: 'https://example.com/original?utm_source=test' }, runtimeContext);

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('web:https://example.com/original');
    expect(result.value.raw.dedupKeys).toContain('https://cdn.example.com/final');
  });
});

describe('buildWebResourceId', () => {
  it('uses the shared canonicalizer', () => {
    expect(buildWebResourceId('https://Example.com/article?utm_source=rss')).toBe('web:https://example.com/article');
  });
});
