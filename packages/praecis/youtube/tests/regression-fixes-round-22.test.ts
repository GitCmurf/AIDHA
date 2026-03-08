import { describe, it, expect } from 'vitest';
import { expandContractions, hasNumericalDifference, hasSubjectOrPredicateChange } from '../src/extract/editorial-ranking.js';
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

  describe('hasSubjectOrPredicateChange (Regression 8)', () => {
    it('detects material changes (like "MPS" vs "metabolism") that Jaccard similarity might miss', () => {
      const s1 = "leucine threshold is critical for MPS stimulation";
      const s2 = "leucine threshold is critical for metabolism regulation";
      expect(hasSubjectOrPredicateChange(s1, s2)).toBe(true);
    });

    it('does not merge opposite-direction claims (increases vs decreases)', () => {
      const s1 = "creatine increases muscle damage";
      const s2 = "creatine decreases muscle damage";
      expect(hasSubjectOrPredicateChange(s1, s2)).toBe(true);

      const s3 = "raises blood pressure significantly";
      const s4 = "lowers blood pressure significantly";
      expect(hasSubjectOrPredicateChange(s3, s4)).toBe(true);
    });

    it('returns true for single-token non-stopword differences (including women/men) to preserve distinct claims', () => {
      const s1 = "vitamin d reduces falls in elderly women";
      const s2 = "vitamin d reduces falls in elderly men";
      expect(hasSubjectOrPredicateChange(s1, s2)).toBe(true);
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

    it('does NOT treat bare "won" as a contraction in normal prose', () => {
      expect(expandContractions("i won the game")).toBe("i won the game");
    });

    it('does NOT treat bare "can" as a negation contraction (Regression 5)', () => {
      // "can" should remain "can", not "can not"
      expect(expandContractions("creatine can improve strength")).toBe("creatine can improve strength");
    });
  });

  describe('splitSentences (Regression 4 & 9)', () => {
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

    it('handles punctuation followed by closing quotes/parens/brackets before the space', () => {
      expect(splitSentences('"Hello." Then he left.')).toEqual(['"Hello."', 'Then he left.']);
      expect(splitSentences("It works (mostly). However...")).toEqual(["It works (mostly).", "However..."]);
      expect(splitSentences("Step 1 [done]. Step 2...")).toEqual(["Step 1 [done].", "Step 2..."]);
    });

    it('splits on min. and max. at end of sentence (Regression 9)', () => {
      const input1 = "we ran for 5 min. then stopped.";
      expect(splitSentences(input1)).toEqual([
        "we ran for 5 min.",
        "then stopped."
      ]);
      const input2 = "set the dial to max. then wait.";
      expect(splitSentences(input2)).toEqual([
        "set the dial to max.",
        "then wait."
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
