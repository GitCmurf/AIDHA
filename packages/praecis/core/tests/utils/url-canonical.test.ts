// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { urlCanonical } from '../../src/utils/url-canonical.js';

describe('urlCanonical', () => {
  it('lowercases scheme and host', () => {
    expect(urlCanonical('HTTPS://EXAMPLE.COM/path')).toBe('https://example.com/path');
  });

  it('strips utm_source', () => {
    expect(urlCanonical('https://example.com/a?utm_source=newsletter')).toBe('https://example.com/a');
  });

  it('strips utm_medium', () => {
    expect(urlCanonical('https://example.com/a?utm_medium=email')).toBe('https://example.com/a');
  });

  it('strips utm_campaign', () => {
    expect(urlCanonical('https://example.com/a?utm_campaign=spring')).toBe('https://example.com/a');
  });

  it('strips utm_content', () => {
    expect(urlCanonical('https://example.com/a?utm_content=hero')).toBe('https://example.com/a');
  });

  it('strips utm_term', () => {
    expect(urlCanonical('https://example.com/a?utm_term=keyword')).toBe('https://example.com/a');
  });

  it('strips fbclid', () => {
    expect(urlCanonical('https://example.com/a?fbclid=abc123')).toBe('https://example.com/a');
  });

  it('strips gclid', () => {
    expect(urlCanonical('https://example.com/a?gclid=xyz789')).toBe('https://example.com/a');
  });

  it('strips ref (exact key match)', () => {
    expect(urlCanonical('https://example.com/a?ref=sidebar')).toBe('https://example.com/a');
  });

  it('does not strip referrer', () => {
    expect(urlCanonical('https://example.com/a?referrer=home')).toBe('https://example.com/a?referrer=home');
  });

  it('does not strip reference', () => {
    expect(urlCanonical('https://example.com/a?reference=doc')).toBe('https://example.com/a?reference=doc');
  });

  it('sorts remaining query params alphabetically', () => {
    expect(urlCanonical('https://example.com/a?z=1&a=2')).toBe('https://example.com/a?a=2&z=1');
  });

  it('strips fragment', () => {
    expect(urlCanonical('https://example.com/a#section')).toBe('https://example.com/a');
  });

  it('drops default port 80 for http', () => {
    expect(urlCanonical('http://example.com:80/path')).toBe('http://example.com/path');
  });

  it('drops default port 443 for https', () => {
    expect(urlCanonical('https://example.com:443/path')).toBe('https://example.com/path');
  });

  it('keeps non-default port', () => {
    expect(urlCanonical('https://example.com:8080/path')).toBe('https://example.com:8080/path');
  });

  it('trailing slash: root URL gets slash', () => {
    expect(urlCanonical('https://example.com')).toBe('https://example.com/');
  });

  it('trailing slash: path with content drops trailing slash', () => {
    expect(urlCanonical('https://example.com/article/')).toBe('https://example.com/article');
  });

  it('path without trailing slash is unchanged', () => {
    expect(urlCanonical('https://example.com/article')).toBe('https://example.com/article');
  });

  it('is deterministic: same input same output every call', () => {
    const url = 'https://example.com/a?z=1&a=2&utm_source=rss#frag';
    expect(urlCanonical(url)).toBe(urlCanonical(url));
  });

  it('returns input unchanged for invalid URL', () => {
    const bad = 'not a url at all';
    expect(urlCanonical(bad)).toBe(bad);
  });

  it('cross-vector consistency: same article URL through different vectors produces same canonical', () => {
    const web = 'https://example.com/article?utm_source=web';
    const rss = 'https://example.com/article?utm_source=rss';
    const readwise = 'https://example.com/article?utm_source=readwise';
    const canonical = 'https://example.com/article';
    expect(urlCanonical(web)).toBe(canonical);
    expect(urlCanonical(rss)).toBe(canonical);
    expect(urlCanonical(readwise)).toBe(canonical);
  });
});
