import { describe, it, expect } from 'vitest';
import { expandContractions, hasNumericalDifference } from '../src/extract/editorial-ranking.js';
import { splitSentences } from '../src/extract/utils.js';

describe('Regression Fixes Round 22', () => {
  describe('hasNumericalDifference (Regression 6)', () => {
    it('flags difference when one text has numbers and the other does not', () => {
      expect(hasNumericalDifference("take 5 g daily", "take creatine daily")).toBe(true);
      expect(hasNumericalDifference("take creatine daily", "take 5 g daily")).toBe(true);
    });

    it('flags difference when both have different numbers', () => {
      expect(hasNumericalDifference("take 5 g daily", "take 10 g daily")).toBe(true);
    });

    it('returns false when neither has numbers', () => {
      expect(hasNumericalDifference("take creatine daily", "use creatine daily")).toBe(false);
    });

    it('returns false when both have same numbers', () => {
      expect(hasNumericalDifference("take 5 g daily", "use 5 g daily")).toBe(false);
    });
  });

  describe('expandContractions (Regression 3 & 5)', () => {
    it('only expands contractions at word boundaries', () => {
      // Should expand
      expect(expandContractions("it won't happen")).toContain("it will not happen");

      // Should NOT expand substrings
      expect(expandContractions("donation")).toBe("donation");
      expect(expandContractions("scan")).toBe("scan");
      expect(expandContractions("wonder")).toBe("wonder");
    });

    it('does NOT treat bare "can" as a negation contraction (Regression 5)', () => {
      // "can" should remain "can", not "can not"
      expect(expandContractions("creatine can improve strength")).toBe("creatine can improve strength");
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
