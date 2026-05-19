import { describe, it, expect } from 'vitest';
import { runEditorPassV2 } from '../src/extract/editorial-ranking.js';
import type { ClaimCandidate } from '../src/extract/types.js';

describe('Editorial Ranking Deduplication', () => {
  it('preserves distinct claims sharing the same excerpt', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Protein intake increases muscle protein synthesis after resistance training.',
        excerptIds: ['e1'],
        confidence: 0.9,
        startSeconds: 10,
      },
      {
        text: 'Sleep restriction reduces glucose tolerance in healthy adults.',
        excerptIds: ['e1'],
        confidence: 0.9,
        startSeconds: 10,
      },
    ];

    const result = runEditorPassV2(candidates, {
      maxClaims: 10,
      chunkCount: 1,
    });

    // Both should be preserved because they are semantically different despite same excerpt
    expect(result).toHaveLength(2);
    expect(result.map(c => c.text)).toContain(candidates[0].text);
    expect(result.map(c => c.text)).toContain(candidates[1].text);
  });

  it('deduplicates similar claims sharing the same excerpt', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Protein intake increases muscle protein synthesis after resistance training.',
        excerptIds: ['e1'],
        confidence: 0.9,
        startSeconds: 10,
      },
      {
        text: 'Protein intake boosts muscle protein synthesis after resistance training.',
        excerptIds: ['e1'],
        confidence: 0.8,
        startSeconds: 10,
      },
    ];

    const result = runEditorPassV2(candidates, {
      maxClaims: 10,
      chunkCount: 1,
    });

    // One should be dropped because they are semantically similar and share excerpt
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(candidates[0].text); // higher confidence one preserved
  });
});
