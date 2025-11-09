import { describe, it, expect } from 'vitest';
import { extractUrls } from '../src/utils/urls.js';

describe('extractUrls', () => {
  it('strips trailing punctuation', () => {
    const text = 'See https://example.com/docs, and then https://example.com/faq.';
    expect(extractUrls(text)).toEqual([
      'https://example.com/docs',
      'https://example.com/faq',
    ]);
  });

  it('keeps balanced parentheses in Wikipedia-style URLs', () => {
    const text = 'Read (https://en.wikipedia.org/wiki/Mars_(planet)) for details.';
    expect(extractUrls(text)).toEqual([
      'https://en.wikipedia.org/wiki/Mars_(planet)',
    ]);
  });
});
