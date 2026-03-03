/**
 * Common abbreviations that should not trigger sentence splits.
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'rep', 'sen',
  'gen', 'col', 'maj', 'capt', 'lt', 'st', 'ave', 'blvd', 'rd',
  'etc', 'eg', 'ie', 'vs', 'approx', 'est', 'min', 'max',
]);

/**
 * Conjunctions and connectors that indicate dangling sentence boundaries.
 * When a text segment ends with these, it's likely a fragment.
 */
const DANGLING_MARKERS = new Set([
  'and', 'but', 'so', 'or', 'yet', 'nor', 'for',
  'which', 'that', 'when', 'where', 'while', 'since',
  'because', 'although', 'though', 'unless', 'is', 'are', 'was', 'were',
]);

/**
 * Fragment indicators that signal incomplete sentences.
 */
const FRAGMENT_INDICATORS = [
  '...',
  '\u2026', // ellipsis character
];

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Creates a normalized key for deduplication.
 * Handles:
 * - Case normalization
 * - Whitespace normalization
 * - Punctuation variants (commas, periods, quotes)
 * - Common stopwords removal for content comparison
 *
 * @param text - The text to normalize
 * @returns A normalized key suitable for deduplication
 */
export function normalizeKey(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    // Remove common punctuation variants
    .replace(/[",;:!?()[\]{}]/g, '')
    // Normalize apostrophes and quotes
    .replace(/[''"""]/g, '')
    // Normalize multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds a map of excerpt IDs to their text content for echo detection.
 * Filters out excerpts with no content.
 */
export function buildExcerptTextsById(excerpts: ReadonlyArray<{ id: string; content?: string | null }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const excerpt of excerpts) {
    if (excerpt.content) {
      map.set(excerpt.id, excerpt.content);
    }
  }
  return map;
}

/**
 * Type-safe helper to extract a string value from metadata.
 */
export function getStringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  return typeof metadata?.[key] === 'string' ? (metadata[key] as string) : undefined;
}

/**
 * Type-safe helper to extract a number value from metadata.
 */
export function getNumberMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  return typeof metadata?.[key] === 'number' ? (metadata[key] as number) : undefined;
}

/**
 * Determines if a text segment ends with a dangling marker.
 * @param text - The text to check
 * @returns true if the text ends with a dangling conjunction or punctuation
 */
export function hasDanglingEnding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Check for fragment indicators like ellipsis
  for (const indicator of FRAGMENT_INDICATORS) {
    if (trimmed.endsWith(indicator)) return true;
  }

  // Check for dangling punctuation marks
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar === ',' || lastChar === ':' || lastChar === ';') {
    return true;
  }

  // Split into words and check the last one
  const words = trimmed.split(/\s+/);
  const lastWord = words[words.length - 1]?.toLowerCase().replace(/[.,;:!?)\]]$/, '');

  if (!lastWord) return false;

  return DANGLING_MARKERS.has(lastWord);
}

/**
 * Splits text into sentences using deterministic rules.
 * Handles common edge cases:
 * - Abbreviations (Mr., Dr., etc.) by checking against known abbreviation list
 * - Decimal numbers (1.5, 3.14) by not treating period as sentence end when followed by digit
 * - Quotations and parentheses
 *
 * @param text - The text to split into sentences
 * @returns Array of sentences, or empty array if input is empty
 */
export function splitSentences(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const sentences: string[] = [];
  let current = '';
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];
    current += char;

    // Check for sentence-ending punctuation
    if (char === '.' || char === '!' || char === '?') {
      // Look ahead to see if this is truly a sentence end
      const nextChar = normalized[i + 1];
      const nextNextChar = normalized[i + 2];

      // Check if current "word" ending with period is an abbreviation
      const currentWords = current.trim().split(/\s+/);
      const lastWord = currentWords[currentWords.length - 1]?.toLowerCase().replace(/[.:!?]$/, '');
      const isAbbreviation = ABBREVIATIONS.has(lastWord);

      // Sentence end conditions:
      // 1. End of string
      // 2. Followed by space and capital letter (or quote/paren)
      // 3. Not part of decimal number (e.g., 1.5)
      // 4. Not a known abbreviation
      const isEndOfString = i === normalized.length - 1;
      const isFollowedBySpaceAndCapital = nextChar === ' ' && (
        nextNextChar && (
          nextNextChar === nextNextChar.toUpperCase() ||
          nextNextChar === '"' ||
          nextNextChar === "'" ||
          nextNextChar === '(' ||
          nextNextChar === '['
        )
      );
      const isNotDecimal = nextChar !== '0' && nextChar !== '1' &&
        nextChar !== '2' && nextChar !== '3' && nextChar !== '4' &&
        nextChar !== '5' && nextChar !== '6' && nextChar !== '7' &&
        nextChar !== '8' && nextChar !== '9';

      if (!isAbbreviation && (isEndOfString || (isFollowedBySpaceAndCapital && isNotDecimal))) {
        const sentence = current.trim();
        if (sentence) {
          sentences.push(sentence);
        }
        current = '';
      }
    }

    i++;
  }

  // Add any remaining text as a sentence
  const remaining = current.trim();
  if (remaining) {
    sentences.push(remaining);
  }

  return sentences;
}

/**
 * Estimates if a text segment is a complete sentence.
 * A complete sentence should:
 * - Start with a capital letter or quotation
 * - End with proper punctuation (. ! ?)
 * - Not have dangling markers
 *
 * @param text - The text to check
 * @returns true if the text appears to be a complete sentence
 */
export function isCompleteSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  // Must start with capital or quote/paren (after stripping opening quotes)
  const firstNonQuote = trimmed.replace(/^["'(\[\s]+/, '')[0];
  const startsProperly = firstNonQuote && firstNonQuote === firstNonQuote.toUpperCase();

  // Must end with proper punctuation
  const endsProperly = /[.!?"]$/.test(lastChar);

  // Should not have dangling ending (but we check this separately for quotes)
  const notDangling = !hasDanglingEnding(trimmed.replace(/[."]$/, ''));

  return startsProperly && endsProperly && notDangling;
}

/**
 * Merges adjacent text segments when they should form a single sentence.
 * Merges when:
 * - The gap between segments is within maxGapSeconds
 * - Either the accumulated text ends with a dangling marker OR the next segment starts with a connector
 *
 * @param segments - Array of text segments with optional startSeconds metadata
 * @param maxGapSeconds - Maximum gap in seconds to consider merging (default 15)
 * @returns Array of merged text segments
 */
export interface MergeableSegment {
  text: string;
  startSeconds?: number;
}

/**
 * Checks if a text segment starts with a connector word (lowercase).
 */
export function startsWithConnector(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/^["'(\[]/, '');
  return DANGLING_MARKERS.has(firstWord);
}

export function mergeAdjacentSegments(
  segments: MergeableSegment[],
  maxGapSeconds: number = 15
): string[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return [segments[0].text];

  const merged: string[] = [];
  let currentText = segments[0].text;
  let lastStart = segments[0].startSeconds;

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const gap = typeof lastStart === 'number' && typeof segment.startSeconds === 'number'
      ? segment.startSeconds - lastStart
      : Infinity;

    // Merge if within gap AND (current text has dangling ending OR next segment starts with connector)
    const shouldMerge = gap <= maxGapSeconds &&
      (hasDanglingEnding(currentText) || startsWithConnector(segment.text));

    if (shouldMerge) {
      currentText += ' ' + segment.text;
      lastStart = segment.startSeconds;
    } else {
      merged.push(currentText);
      currentText = segment.text;
      lastStart = segment.startSeconds;
    }
  }

  // Don't forget the last segment
  merged.push(currentText);

  return merged;
}

/**
 * Counts fragment indicators in text.
 * Used for quality metrics.
 *
 * @param text - The text to analyze
 * @returns Number of fragment indicators found
 */
export function countFragmentIndicators(text: string): number {
  let count = 0;

  // Count ellipsis occurrences (handle both ... and unicode ellipsis)
  const ellipsisMatches = text.match(/\.{3}|\u2026/g);
  count += ellipsisMatches?.length ?? 0;

  // Check for dangling ending (but don't double-count if it ends with ellipsis)
  const trimmed = text.trim();
  const endsWithEllipsis = FRAGMENT_INDICATORS.some(indicator => trimmed.endsWith(indicator));

  if (!endsWithEllipsis && hasDanglingEnding(text)) {
    count += 1;
  }

  return count;
}
