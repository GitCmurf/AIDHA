import { describe, expect, it } from 'vitest';
import { WebIngestor, WebTextDecodeStrategy } from '../src/index.js';

const wallHtml = '<html><title>Blocked</title><body><p>Sign in to continue reading this article.</p></body></html>';

describe('web paywall/login-wall detection', () => {
  it('fails acquisition before a stub resource can be persisted', async () => {
    const ingestor = new WebIngestor({
      fetchFn: async () => ({
        ok: true,
        url: 'https://example.com/paywalled',
        status: 200,
        async text() {
          return wallHtml;
        },
      }),
    });

    const result = await ingestor.acquire({ ref: 'https://example.com/paywalled' });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('paywall/login wall detected');
  });

  it('fails decode if a pre-fetched payload is a login-wall stub', async () => {
    const result = await new WebTextDecodeStrategy().decode({
      raw: {
        canonicalId: 'web:https://example.com/paywalled',
        sourceType: 'web',
        sensitivity: 'public',
        provenance: { ingestedAt: '2026-05-25T00:00:00.000Z', sourceType: 'web' },
        payload: {
          url: 'https://example.com/paywalled',
          canonicalUrl: 'https://example.com/paywalled',
          resolvedCanonicalUrl: 'https://example.com/paywalled',
          title: 'Blocked',
          html: wallHtml,
          text: 'Sign in to continue reading this article.',
        },
        label: 'Blocked',
      },
      config: {} as Parameters<WebTextDecodeStrategy['decode']>[0]['config'],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('paywall/login wall detected');
  });
});
