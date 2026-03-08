import { describe, expect, it } from 'vitest';
import { hashId } from '../src/utils/ids.js';
import { uniqueSortedStrings } from '../src/extract/utils.js';

describe('Claim ID Collision', () => {
  it('generates distinct IDs for claims differing only by punctuation', () => {
    const resourceId = 'youtube-test-video';
    const excerptIds = ['ex1'];
    const sortedExcerptIds = uniqueSortedStrings(excerptIds);

    // Previously these would have both normalized to "50 g of protein"
    // and resulted in the same hash.
    const text1 = '5.0 g of protein';
    const text2 = '50 g of protein';

    const id1 = hashId('claim', [resourceId, text1, ...sortedExcerptIds]);
    const id2 = hashId('claim', [resourceId, text2, ...sortedExcerptIds]);

    expect(id1).not.toBe(id2);
    // Values verified from manual hashId call on raw strings
    expect(id1).toBe('claim-18127c2b5df3174c');
    expect(id2).toBe('claim-3bd436a138179d88');
  });

  it('generates identical IDs for identical text and excerpts', () => {
    const resourceId = 'youtube-test-video';
    const excerptIds = ['ex1', 'ex2'];
    const sortedExcerptIds = uniqueSortedStrings(excerptIds);

    const text = 'Same text';

    const id1 = hashId('claim', [resourceId, text, ...sortedExcerptIds]);

    // Different order of excerpts, but same content
    const excerptIds2 = ['ex2', 'ex1'];
    const sortedExcerptIds2 = uniqueSortedStrings(excerptIds2);
    const id2 = hashId('claim', [resourceId, text, ...sortedExcerptIds2]);

    expect(id1).toBe(id2);
  });
});
