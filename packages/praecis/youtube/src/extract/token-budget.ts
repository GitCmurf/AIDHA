/**
 * Token Budget Management
 *
 * Provides token estimation and budget enforcement for LLM-based extraction.
 * Prevents unbounded token usage and maintains cost predictability.
 */

import { splitSentences, normalizeText } from './utils.js';

/**
 * Estimates token count for a given text.
 * Uses a conservative heuristic: ~4 characters per token for English text.
 * This is a rough estimate that tends to overestimate slightly.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Reuse normalizeText for consistent whitespace handling
  const normalized = normalizeText(text);

  // Conservative estimate: 4 chars per token
  // This overestimates slightly for text with many short words
  // and underestimates slightly for dense technical text
  return Math.ceil(normalized.length / 4);
}

/**
 * Maximum token budget per video to prevent runaway costs.
 * At $0.01 per 1k tokens (conservative GPT-4 pricing), 50k tokens = $0.50 per video
 */
const MAX_TOKENS_PER_VIDEO = 50_000;

/**
 * Maximum tokens per chunk to prevent single chunk from dominating budget.
 */
const MAX_TOKENS_PER_CHUNK = 10_000;

/**
 * Target tokens per chunk for optimal extraction quality.
 */
const TARGET_TOKENS_PER_CHUNK = 3_000;

/**
 * Chunk options with token budget considerations.
 */
export interface ChunkTokenBudget {
  maxChunks: number;
  targetTokensPerChunk: number;
  maxTokensPerChunk: number;
  totalBudget: number;
}

/**
 * Calculates recommended chunking strategy based on transcript length.
 */
export function calculateChunkBudget(transcriptText: string, chunkCount: number): { budget: ChunkTokenBudget, overBudget: boolean } {
  const totalTokens = estimateTokens(transcriptText);

  // Check if over budget before capping
  const overBudget = totalTokens > MAX_TOKENS_PER_VIDEO;

  // Cap total budget to prevent runaway costs
  const cappedTotal = Math.min(totalTokens, MAX_TOKENS_PER_VIDEO);

  const requestedChunks = Math.max(1, chunkCount);
  const requiredChunks = Math.max(1, Math.ceil(cappedTotal / MAX_TOKENS_PER_CHUNK));
  const effectiveChunks = Math.max(requestedChunks, requiredChunks);

  // Calculate tokens per chunk if evenly distributed
  const tokensPerChunk = Math.ceil(cappedTotal / effectiveChunks);

  // Apply per-chunk limit
  const boundedPerChunk = Math.min(tokensPerChunk, MAX_TOKENS_PER_CHUNK);

  return {
    overBudget,
    budget: {
      maxChunks: effectiveChunks,
      targetTokensPerChunk: Math.min(TARGET_TOKENS_PER_CHUNK, boundedPerChunk),
      maxTokensPerChunk: boundedPerChunk,
      totalBudget: cappedTotal,
    },
  };
}

/**
 * Checks if a transcript exceeds the token budget and needs chunking.
 */
export function exceedsTokenBudget(transcriptText: string, threshold: number = TARGET_TOKENS_PER_CHUNK): boolean {
  return estimateTokens(transcriptText) > threshold;
}

/**
 * Splits text into chunks that fit within the token budget.
 * Attempts to split at sentence boundaries when possible.
 */
export function chunkTextByTokenBudget(
  text: string,
  maxTokensPerChunk: number = TARGET_TOKENS_PER_CHUNK
): string[] {
  const chunks: string[] = [];
  const sentences = splitSentences(text);

  let currentChunk = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    // Single sentence exceeds budget - force split
    if (sentenceTokens > maxTokensPerChunk) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentTokens = 0;
      }
      // Split long sentence into smaller pieces
      const words = sentence.split(/\s+/);
      let tempChunk = '';
      let tempTokens = 0;

      for (const word of words) {
        const separatorTokens = tempChunk ? 1 : 0;
        const wordTokens = estimateTokens(word);
        if (tempTokens + separatorTokens + wordTokens > maxTokensPerChunk && tempChunk) {
          chunks.push(tempChunk.trim());
          tempChunk = word;
          tempTokens = wordTokens;
        } else {
          tempChunk += (tempChunk ? ' ' : '') + word;
          tempTokens += separatorTokens + wordTokens;
        }
      }

      if (tempChunk) {
        currentChunk = tempChunk;
        currentTokens = tempTokens;
      }
      continue;
    }

    // Adding this sentence would exceed budget - save current chunk
    const separatorTokens = currentChunk ? 1 : 0;
    if (currentTokens + separatorTokens + sentenceTokens > maxTokensPerChunk && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
      currentTokens = sentenceTokens;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentTokens += separatorTokens + sentenceTokens;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Formats token count for human-readable display.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Estimates cost in USD for a given token count and price per 1k tokens.
 */
export function estimateCost(tokens: number, pricePer1kTokens: number): number {
  return (tokens / 1000) * pricePer1kTokens;
}

/**
 * Default conservative price per 1k tokens (USD) for cost estimation warnings.
 * This is intentionally high to provide conservative cost projections.
 */
export const DEFAULT_COST_PER_1K_TOKENS = 0.01;

/**
 * Token budget summary for logging and diagnostics.
 */
export interface TokenBudgetSummary {
  estimatedTokens: number;
  chunkCount: number;
  tokensPerChunk: number;
  underBudget: boolean;
  estimatedCostUsd?: number;
  pricePer1kTokens?: number;
}

/**
 * Creates a token budget summary for a transcript.
 */
export function createTokenBudgetSummary(
  transcriptText: string,
  chunkCount: number,
  pricePer1kTokens?: number
): TokenBudgetSummary {
  const result = calculateChunkBudget(transcriptText, chunkCount);
  const budget = result.budget;

  return {
    estimatedTokens: budget.totalBudget,
    chunkCount: budget.maxChunks,
    tokensPerChunk: budget.maxTokensPerChunk,
    underBudget: !result.overBudget,
    ...(pricePer1kTokens !== undefined && {
      estimatedCostUsd: estimateCost(budget.totalBudget, pricePer1kTokens),
      pricePer1kTokens,
    }),
  };
}
