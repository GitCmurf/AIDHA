import { describe, it, expect } from 'vitest';
import { expandContractions } from '../src/extract/editorial-ranking.js';
import { splitSentences } from '../src/extract/utils.js';

describe('Regression Fixes Round 22', () => {
  describe('expandContractions (Regression 3)', () => {
    it('only expands contractions at word boundaries', () => {
      // Should expand
      expect(expandContractions("creatine can improve strength")).toContain("creatine can not improve strength");
      expect(expandContractions("it won't happen")).toContain("it will not happen");

      // Should NOT expand substrings
      expect(expandContractions("donation")).toBe("donation");
      expect(expandContractions("scan")).toBe("scan");
      expect(expandContractions("wonder")).toBe("wonder");
    });
  });

  describe('splitSentences (Regression 4)', () => {
    it('splits sentences even when next sentence is lowercase (ASR transcripts)', () => {
      const input = "first sentence. second sentence? third sentence! last one";
      const result = splitSentences(input);
      expect(result).toEqual([
        "first sentence.",
        "second sentence?",
        "third sentence!",
        "last one"
      ]);
    });

    it('respects abbreviations even with lowercase next sentence', () => {
      const input = "take e.g. magnesium. it helps.";
      const result = splitSentences(input);
      expect(result).toEqual([
        "take e.g. magnesium.",
        "it helps."
      ]);
    });

    it('respects decimal points', () => {
      const input = "take 1.5 grams. daily.";
      const result = splitSentences(input);
      expect(result).toEqual([
        "take 1.5 grams.",
        "daily."
      ]);
    });
  });
});
