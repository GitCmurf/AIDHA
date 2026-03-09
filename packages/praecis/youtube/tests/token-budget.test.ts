/**
 * Token Budget Tests
 *
 * Tests token estimation, budget calculation, and chunking logic.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  calculateChunkBudget,
  exceedsTokenBudget,
  chunkTextByTokenBudget,
  formatTokenCount,
  estimateCost,
  createTokenBudgetSummary,
} from '../src/extract/token-budget.js';

describe('token-budget', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty text', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('   ')).toBe(0);
    });

    it('estimates tokens for short text', () => {
      // ~20 chars / 4 = ~5 tokens
      expect(estimateTokens('This is a test.')).toBeGreaterThan(0);
      expect(estimateTokens('This is a test.')).toBeLessThan(10);
    });

    it('handles repeated whitespace correctly', () => {
      const normal = 'This is a test.';
      const extraSpaces = 'This    is   a  test.';
      // Should normalize whitespace before counting
      expect(estimateTokens(normal)).toBe(estimateTokens(extraSpaces));
    });

    it('estimates higher for longer text', () => {
      const short = 'Hello world.';
      const long = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

      expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
    });

    it('produces consistent estimates for identical content', () => {
      const text = 'Muscle protein synthesis increases linearly beyond thirty grams per meal.';
      const first = estimateTokens(text);
      const second = estimateTokens(text);

      expect(first).toBe(second);
    });
  });

  describe('calculateChunkBudget', () => {
    it('calculates budget for short transcript', () => {
      const short = 'This is a short transcript with minimal content.';
      const result = calculateChunkBudget(short, 3);
      const budget = result.budget;

      expect(budget.maxChunks).toBe(3);
      expect(budget.totalBudget).toBeLessThan(500);
      expect(budget.targetTokensPerChunk).toBeLessThan(500);
      expect(result.overBudget).toBe(false);
    });

    it('caps budget at MAX_TOKENS_PER_VIDEO', () => {
      // Create very long text that would exceed 50k tokens
      const longText = 'Word '.repeat(100_000); // ~600k characters
      const result = calculateChunkBudget(longText, 10);
      const budget = result.budget;

      expect(budget.totalBudget).toBeLessThanOrEqual(50_000);
      expect(result.overBudget).toBe(true);
    });

    it('distributes tokens evenly across chunks', () => {
      const text = 'A'.repeat(10_000); // ~2.5k tokens
      const result = calculateChunkBudget(text, 5);
      const budget = result.budget;

      expect(budget.maxChunks).toBe(5);
      // Each chunk should get roughly 1/5 of the tokens
      expect(budget.targetTokensPerChunk).toBeGreaterThan(0);
      expect(budget.maxTokensPerChunk).toBeGreaterThan(0);
    });

    it('respects maxTokensPerChunk limit', () => {
      const text = 'A'.repeat(50_000); // ~12.5k tokens
      const result = calculateChunkBudget(text, 2);
      const budget = result.budget;

      expect(budget.maxTokensPerChunk).toBeLessThanOrEqual(10_000);
    });

    it('increases maxChunks when requested chunks cannot fit the capped budget', () => {
      const text = 'A'.repeat(200_000); // ~50k tokens after capping
      const result = calculateChunkBudget(text, 1);
      const budget = result.budget;

      expect(budget.totalBudget).toBe(50_000);
      expect(budget.maxTokensPerChunk).toBeLessThanOrEqual(10_000);
      expect(budget.maxChunks).toBeGreaterThan(1);
      expect(budget.maxChunks * budget.maxTokensPerChunk).toBeGreaterThanOrEqual(budget.totalBudget);
    });
  });

  describe('exceedsTokenBudget', () => {
    it('returns false for short text', () => {
      expect(exceedsTokenBudget('Short text.')).toBe(false);
    });

    it('returns true for long text', () => {
      const long = 'Word '.repeat(3_000); // ~15k chars = ~3,750 tokens, exceeds default 3k threshold
      expect(exceedsTokenBudget(long, 3_000)).toBe(true);
    });

    it('uses custom threshold when provided', () => {
      const text = 'A'.repeat(1_000); // ~250 tokens

      expect(exceedsTokenBudget(text, 100)).toBe(true);
      expect(exceedsTokenBudget(text, 10_000)).toBe(false);
    });
  });

  describe('chunkTextByTokenBudget', () => {
    it('handles empty text', () => {
      expect(chunkTextByTokenBudget('')).toEqual([]);
    });

    it('keeps short text in single chunk', () => {
      const short = 'This is a short transcript.';
      const chunks = chunkTextByTokenBudget(short, 5_000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(short);
    });

    it('splits long text into multiple chunks', () => {
      const long = 'This is a test sentence that is repeated multiple times. '.repeat(100); // Multiple sentences
      const chunks = chunkTextByTokenBudget(long, 200); // Small budget to force split

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('attempts to split at sentence boundaries', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const chunks = chunkTextByTokenBudget(text, 30); // Small budget to force split

      // Chunks should start with capital letters (sentence boundaries)
      chunks.forEach(chunk => {
        const trimmed = chunk.trim();
        if (trimmed.length > 0) {
          expect(trimmed[0]).toMatch(/[A-Z]/);
        }
      });
    });

    it('handles single very long sentence', () => {
      // Single long sentence without periods
      const longSentence = 'Word '.repeat(500);
      const chunks = chunkTextByTokenBudget(longSentence, 500);

      // Should still split despite lack of periods
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('does not overcount separator tokens when splitting long sentences into words', () => {
      const chunks = chunkTextByTokenBudget('aa bb cc dd ee', 3);

      expect(chunks).toEqual(['aa bb', 'cc dd', 'ee']);
    });

    it('preserves all content across chunks', () => {
      const original = 'A'.repeat(5_000);
      const chunks = chunkTextByTokenBudget(original, 500);

      const rejoined = chunks.join('');
      // Length should be nearly identical (allow small variance for whitespace normalization)
      expect(rejoined.length).toBeGreaterThanOrEqual(original.length - 100);
      expect(rejoined.length).toBeLessThanOrEqual(original.length + 100);
    });
  });

  describe('formatTokenCount', () => {
    it('formats small numbers as-is', () => {
      expect(formatTokenCount(500)).toBe('500');
      expect(formatTokenCount(999)).toBe('999');
    });

    it('formats thousands with K suffix', () => {
      expect(formatTokenCount(1_000)).toBe('1.0K');
      expect(formatTokenCount(5_500)).toBe('5.5K');
      expect(formatTokenCount(50_000)).toBe('50.0K');
      expect(formatTokenCount(999_999)).toBe('1000.0K');
    });

    it('formats millions with M suffix', () => {
      expect(formatTokenCount(1_000_000)).toBe('1.0M');
      expect(formatTokenCount(2_500_000)).toBe('2.5M');
    });
  });

  describe('estimateCost', () => {
    it('calculates zero cost for zero tokens', () => {
      expect(estimateCost(0, 0.01)).toBe(0);
    });

    it('calculates cost for token count', () => {
      // 1k tokens at $0.01 per 1k = $0.01
      expect(estimateCost(1_000, 0.01)).toBe(0.01);

      // 10k tokens at $0.01 per 1k = $0.10
      expect(estimateCost(10_000, 0.01)).toBe(0.10);
    });

    it('handles fractional pricing', () => {
      const cost = estimateCost(2_500, 0.003);
      // 2.5 * 0.003 = 0.0075
      expect(cost).toBeCloseTo(0.0075, 5);
    });
  });

  describe('createTokenBudgetSummary', () => {
    it('creates summary without cost estimation', () => {
      const text = 'Test transcript content.';
      const summary = createTokenBudgetSummary(text, 3);

      expect(summary.estimatedTokens).toBeGreaterThan(0);
      expect(summary.chunkCount).toBe(3);
      expect(summary.tokensPerChunk).toBeGreaterThan(0);
      expect(summary.underBudget).toBe(true);
      expect(summary.estimatedCostUsd).toBeUndefined();
    });

    it('includes cost when price provided', () => {
      const text = 'Test transcript content.';
      const summary = createTokenBudgetSummary(text, 3, 0.01);

      expect(summary.estimatedCostUsd).toBeDefined();
      expect(summary.pricePer1kTokens).toBe(0.01);
      expect(summary.estimatedCostUsd).toBeGreaterThan(0);
    });

    it('flags when over budget', () => {
      // Create text that exceeds 50k tokens (at 4 chars/token = 200k chars)
      const text = 'Word '.repeat(100_000); // ~500k characters = ~125k tokens
      const summary = createTokenBudgetSummary(text, 10);

      expect(summary.underBudget).toBe(false);
      expect(summary.estimatedTokens).toBeGreaterThan(50_000); // Actual estimate
      expect(summary.budgetedTokens).toBe(50_000); // Capped
    });
  });
});
