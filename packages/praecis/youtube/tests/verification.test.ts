import { describe, it, expect } from 'vitest';
import { GENERIC_TERMS, GENERIC_TERMS_MAX } from '../src/extract/keyphrases.js';
import {
  TieredVerifier,
  calculateTokenOverlap,
  calculateNGramOverlap,
  extractKeyPhrases,
} from '../src/extract/verification.js';

describe('verification', () => {
  describe('calculateTokenOverlap', () => {
    it('returns 1 for identical texts', () => {
      const overlap = calculateTokenOverlap('the cat sat', 'the cat sat');
      expect(overlap).toBe(1);
    });

    it('returns 0 for completely different texts', () => {
      const overlap = calculateTokenOverlap('abc def', 'xyz 123');
      expect(overlap).toBe(0);
    });

    it('calculates Jaccard-like overlap correctly', () => {
      // "cat sat" vs "cat sat mat" = 2 shared / 3 unique = 0.67
      const overlap = calculateTokenOverlap('the cat sat', 'the cat sat on mat');
      expect(overlap).toBeGreaterThan(0.5);
      expect(overlap).toBeLessThan(0.8);
    });

    it('ignores stopwords', () => {
      // "cat" vs "the cat" should be 1.0 after stopword removal
      const overlap = calculateTokenOverlap('cat', 'the cat');
      expect(overlap).toBe(1);
    });

    it('handles empty strings', () => {
      expect(calculateTokenOverlap('', 'some text')).toBe(0);
      expect(calculateTokenOverlap('some text', '')).toBe(0);
      expect(calculateTokenOverlap('', '')).toBe(0);
    });
  });

  describe('calculateNGramOverlap', () => {
    it('returns 1 for identical texts with bigrams', () => {
      const overlap = calculateNGramOverlap('the cat sat', 'the cat sat', 2);
      expect(overlap).toBe(1);
    });

    it('returns 0 when texts are too short for n-grams', () => {
      const overlap = calculateNGramOverlap('cat', 'dog', 2);
      expect(overlap).toBe(0);
    });

    it('calculates bigram overlap correctly', () => {
      // "cat sat" vs "cat ran" - "cat" is the only shared token
      // After stopword removal: "cat_sat" vs "cat_ran"
      // 0 shared bigrams / 2 unique = 0
      const overlap = calculateNGramOverlap('cat sat', 'cat ran', 2);
      expect(overlap).toBe(0);
    });

    it('uses default n=2 when not specified', () => {
      const overlap1 = calculateNGramOverlap('the cat sat', 'the cat sat');
      const overlap2 = calculateNGramOverlap('the cat sat', 'the cat sat', 2);
      expect(overlap1).toBe(overlap2);
    });
  });

  describe('extractKeyPhrases', () => {
    it('keeps GENERIC_TERMS within the curated cap', () => {
      expect(GENERIC_TERMS.size).toBeLessThanOrEqual(GENERIC_TERMS_MAX);
    });

    it('extracts capitalized proper nouns', () => {
      const phrases = extractKeyPhrases('Artificial Intelligence is transforming healthcare');
      expect(phrases).toContain('artificial intelligence');
    });

    it('suppresses ultra-generic terms', () => {
      const phrases = extractKeyPhrases('The study shows significant results from the research');
      expect(phrases).not.toContain('study');
      expect(phrases).not.toContain('research');
      expect(phrases).not.toContain('results');
      expect(phrases).toEqual([]);
    });

    it('retains meaningful domain terms', () => {
      const phrases = extractKeyPhrases('Leucine stimulates muscle protein synthesis');
      expect(phrases).toContain('leucine');
      expect(phrases).toContain('muscle');
      expect(phrases).toContain('protein');
      expect(phrases).toContain('synthesis');
    });

    it('retains non-health domain terms', () => {
      const phrases = extractKeyPhrases('Kubernetes clusters use etcd for state storage');
      expect(phrases).toContain('kubernetes');
      expect(phrases).toContain('etcd');
      expect(phrases).toContain('storage');
    });

    it('retains acronyms', () => {
      const phrases = extractKeyPhrases('ATP and HTTP are core acronyms');
      expect(phrases).toContain('atp');
      expect(phrases).toContain('http');
    });

    it('retains hyphenated and alphanumeric terms', () => {
      const phrases = extractKeyPhrases('COVID-19 and T-cell responses are state-of-the-art');
      expect(phrases).toContain('covid-19');
      expect(phrases).toContain('t-cell');
      expect(phrases).toContain('state-of-the-art');
    });

    it('does not treat sentence-initial capitalization as named-entity evidence', () => {
      const phrases = extractKeyPhrases('Study results vary across cohorts');
      expect(phrases).not.toContain('study');
      expect(phrases).not.toContain('results');
    });

    it('returns empty array for text with no key phrases', () => {
      const phrases = extractKeyPhrases('the and or but');
      expect(phrases).toEqual([]);
    });

    it('removes duplicates', () => {
      const phrases = extractKeyPhrases('AI and AI are the same');
      const uniquePhrases = [...new Set(phrases)];
      expect(phrases.length).toBe(uniquePhrases.length);
    });
  });

  describe('TieredVerifier', () => {
    describe('constructor', () => {
      it('uses default config when none provided', () => {
        const verifier = new TieredVerifier();
        // Access private config through verifyLexical behavior
        const result = verifier.verifyLexical('cat dog', ['cat dog bird']);
        // Default threshold is 0.3, overlap should be 0.67
        expect(result.verified).toBe(true);
      });

      it('allows custom thresholds', () => {
        const verifier = new TieredVerifier({ lexicalThreshold: 0.8 });
        const result = verifier.verifyLexical('cat dog', ['cat dog bird']);
        // Overlap is 0.67, threshold is 0.8
        expect(result.verified).toBe(false);
      });
    });

    describe('verifyLexical', () => {
      it('returns verified=true when overlap exceeds threshold', () => {
        const verifier = new TieredVerifier({ lexicalThreshold: 0.3 });
        const result = verifier.verifyLexical('climate change', ['climate change effects']);
        expect(result.verified).toBe(true);
        expect(result.overlap).toBeGreaterThan(0);
      });

      it('returns verified=false when overlap is below threshold', () => {
        const verifier = new TieredVerifier({ lexicalThreshold: 0.9 });
        const result = verifier.verifyLexical('xyz abc', ['completely different text']);
        expect(result.verified).toBe(false);
      });

      it('handles empty claim', () => {
        const verifier = new TieredVerifier();
        const result = verifier.verifyLexical('', ['some text']);
        expect(result.verified).toBe(false);
        expect(result.overlap).toBe(0);
      });

      it('handles empty sources', () => {
        const verifier = new TieredVerifier();
        const result = verifier.verifyLexical('some claim', []);
        expect(result.verified).toBe(false);
        expect(result.overlap).toBe(0);
      });
    });

    describe('verifySemantic', () => {
      it('returns verified=true when similarity exceeds threshold', async () => {
        const verifier = new TieredVerifier({ semanticThreshold: 0.5 });
        const result = await verifier.verifySemantic(
          'climate change warming effects planet',
          ['climate change warming effects planet']
        );
        expect(result.verified).toBe(true);
        expect(result.similarity).toBeGreaterThan(0.5);
      });

      it('returns verified=false when similarity is below threshold', async () => {
        const verifier = new TieredVerifier({ semanticThreshold: 0.95 });
        const result = await verifier.verifySemantic(
          'abc xyz',
          ['completely unrelated topic']
        );
        expect(result.verified).toBe(false);
      });

      it('handles empty claim', async () => {
        const verifier = new TieredVerifier();
        const result = await verifier.verifySemantic('', ['some text']);
        expect(result.verified).toBe(false);
        expect(result.similarity).toBe(0);
      });
    });

    describe('verifyEntailment', () => {
      it('returns verified based on semantic similarity proxy', async () => {
        const verifier = new TieredVerifier({
          lexicalThreshold: 0.01,
          semanticThreshold: 0.01,
          entailmentThreshold: 0.5
        });
        const result = await verifier.verifyEntailment(
          'renewable energy reduces emissions',
          ['renewable energy reduces carbon emissions']
        );
        expect(result.score).toBeGreaterThan(0);
        expect(typeof result.verified).toBe('boolean');
      });

      it('returns verified=false for low similarity', async () => {
        const verifier = new TieredVerifier({ entailmentThreshold: 0.9 });
        const result = await verifier.verifyEntailment(
          'abc xyz',
          ['123 456']
        );
        expect(result.verified).toBe(false);
      });
    });

    describe('verify (full pipeline)', () => {
      it('stops at lexical tier when lexical fails', async () => {
        const verifier = new TieredVerifier({ lexicalThreshold: 0.9 });
        const result = await verifier.verify('abc', ['xyz']);
        expect(result.verified).toBe(false);
        expect(result.tier).toBe('lexical');
        expect(result.details.lexicalOverlap).toBeDefined();
        expect(result.details.semanticSimilarity).toBeUndefined();
      });

      it('stops at semantic tier when semantic fails', async () => {
        const verifier = new TieredVerifier({
          lexicalThreshold: 0.01, // Very low to pass lexical
          semanticThreshold: 0.99, // Very high to fail semantic
        });
        const result = await verifier.verify('cat', ['cat sat']);
        expect(result.verified).toBe(false);
        expect(result.tier).toBe('semantic');
        expect(result.details.lexicalOverlap).toBeDefined();
        expect(result.details.semanticSimilarity).toBeDefined();
      });

      it('reaches entailment tier when all pass', async () => {
        const verifier = new TieredVerifier({
          lexicalThreshold: 0.01,
          semanticThreshold: 0.01,
          entailmentThreshold: 0.01,
        });
        const result = await verifier.verify(
          'the cat sat on the mat',
          ['the cat sat on the mat']
        );
        expect(result.verified).toBe(true);
        expect(result.tier).toBe('entailment');
        expect(result.details.lexicalOverlap).toBeDefined();
        expect(result.details.semanticSimilarity).toBeDefined();
        expect(result.details.entailmentScore).toBeDefined();
      });

      it('includes issues when verification fails', async () => {
        const verifier = new TieredVerifier({ lexicalThreshold: 0.9 });
        const result = await verifier.verify('abc', ['xyz']);
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues[0]).toContain('lexical');
      });

      it('returns confidence in range [0, 1]', async () => {
        const verifier = new TieredVerifier();
        const result = await verifier.verify('test claim', ['test source']);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      });
    });
  });
});
