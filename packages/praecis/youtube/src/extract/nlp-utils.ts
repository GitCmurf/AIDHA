/**
 * NLP utilities using compromise.js for linguistic analysis.
 *
 * @module nlp-utils
 * @description Provides SVO extraction, discourse marker detection, POS pattern
 * matching, grammatical completeness checking, keyword extraction, and
 * boilerplate detection for transcript analysis.
 *
 * @note This module requires `compromise` as a dependency.
 * Install with: `npm install compromise` or `pnpm add compromise`
 *
 * @example
 * ```ts
 * import {
 *   extractSVOTriples,
 *   extractDiscourseMarkers,
 *   isGrammaticallyComplete,
 * } from './nlp-utils';
 *
 * const triples = extractSVOTriples('The company launched a new product.');
 * // => [{ subject: 'The company', verb: 'launched', object: 'a new product' }]
 * ```
 */

import nlp from 'compromise';
import { STOPWORDS, GENERIC_TERMS } from './keyphrases.js';

/**
 * Represents a Subject-Verb-Object triple extracted from text.
 */
export interface SVOTriple {
  /** The subject noun phrase */
  subject: string;
  /** The main verb or verb phrase */
  verb: string;
  /** The object noun phrase */
  object: string;
}

/**
 * Represents a discourse marker found in text.
 */
export interface DiscourseMarker {
  /** The marker text */
  marker: string;
  /** Position in the sentence */
  position: 'start' | 'middle' | 'end';
  /** Discourse relation type */
  type: string;
}

/**
 * Map of discourse markers to their semantic types.
 */
const DISCOURSE_MARKERS: Record<string, string> = {
  // Contrast markers
  however: 'contrast',
  although: 'contrast',
  though: 'contrast',
  whereas: 'contrast',
  while: 'contrast',
  'even though': 'contrast',
  'in contrast': 'contrast',
  'on the other hand': 'contrast',
  conversely: 'contrast',
  'by contrast': 'contrast',
  yet: 'contrast',
  nevertheless: 'contrast',
  nonetheless: 'contrast',
  despite: 'contrast',
  notwithstanding: 'contrast',

  // Causal markers
  because: 'causal',
  therefore: 'causal',
  thus: 'causal',
  hence: 'causal',
  consequently: 'causal',
  'as a result': 'causal',
  'for this reason': 'causal',
  since: 'causal',
  'so that': 'causal',
  'due to': 'causal',
  owing: 'causal',

  // Additive markers
  furthermore: 'additive',
  moreover: 'additive',
  additionally: 'additive',
  'in addition': 'additive',
  also: 'additive',
  besides: 'additive',
  'what is more': 'additive',
  'not only': 'additive',
  'but also': 'additive',
  likewise: 'additive',
  similarly: 'additive',

  // Exemplification markers
  'for example': 'exemplification',
  'for instance': 'exemplification',
  'such as': 'exemplification',
  'e.g.': 'exemplification',
  namely: 'exemplification',
  specifically: 'exemplification',
  'in particular': 'exemplification',
  including: 'exemplification',

  // Concession markers
  admittedly: 'concession',
  'of course': 'concession',
  certainly: 'concession',
  clearly: 'concession',
  obviously: 'concession',

  // Temporal/Sequential markers
  meanwhile: 'temporal',
  'in the meantime': 'temporal',
  'at the same time': 'temporal',
  simultaneously: 'temporal',
  subsequently: 'temporal',
  afterward: 'temporal',
  'after that': 'temporal',
  previously: 'temporal',
  'before that': 'temporal',

  // Summary/Conclusion markers
  'in conclusion': 'conclusion',
  'to summarize': 'conclusion',
  'in summary': 'conclusion',
  'in short': 'conclusion',
  briefly: 'conclusion',
  overall: 'conclusion',
  altogether: 'conclusion',
  ultimately: 'conclusion',
  finally: 'conclusion',

  // Conditional markers
  'if so': 'conditional',
  'if not': 'conditional',
  otherwise: 'conditional',
  alternatively: 'conditional',
  'in that case': 'conditional',
};

/**
 * Multi-word markers for accurate matching.
 */
const MULTI_WORD_MARKERS = [
  'even though',
  'in contrast',
  'on the other hand',
  'by contrast',
  'as a result',
  'for this reason',
  'so that',
  'due to',
  'in addition',
  'what is more',
  'not only',
  'but also',
  'for example',
  'for instance',
  'such as',
  'e.g.',
  'in particular',
  'of course',
  'in the meantime',
  'at the same time',
  'after that',
  'before that',
  'in conclusion',
  'to summarize',
  'in summary',
  'in short',
  'if so',
  'if not',
  'in that case',
];

/**
 * Extracts Subject-Verb-Object triples from text using compromise.
 *
 * @param text - The input text to analyze
 * @returns Array of SVO triples with subject, verb, and object strings
 *
 * @example
 * ```ts
 * extractSVOTriples('The company launched a new product. Investors were excited.');
 * // => [
 * //   { subject: 'company', verb: 'launched', object: 'a new product' },
 * //   { subject: 'Investors', verb: 'were', object: 'excited' }
 * // ]
 * ```
 */
export function extractSVOTriples(text: string): SVOTriple[] {
  const doc = nlp(text);
  const sentences = doc.sentences();
  const triples: SVOTriple[] = [];

  for (const sentence of sentences.json()) {
    const terms = sentence.terms || [];
    if (terms.length < 3) continue;

    // Find verb position
    let verbIndex = -1;
    for (let i = 0; i < terms.length; i++) {
      const tags = normalizeTags(terms[i]?.tags);
      if (tags.includes('Verb') || tags.includes('Auxiliary')) {
        verbIndex = i;
        break;
      }
    }

    if (verbIndex === -1) continue;

    // Extract subject (noun phrases before verb)
    const subjectTerms: string[] = [];
    for (let i = 0; i < verbIndex; i++) {
      const term = terms[i];
      if (!term) continue;
      const tags = normalizeTags(term.tags);
      // Skip prepositions at the start
      if (i === 0 && tags.includes('Preposition')) {
        continue;
      }
      if (term.text) {
        subjectTerms.push(term.text);
      }
    }

    // Extract verb
    const verbTerms: string[] = [];
    for (let i = verbIndex; i < terms.length; i++) {
      const term = terms[i];
      if (!term) break;
      const tags = normalizeTags(term.tags);
      if (tags.includes('Verb') || tags.includes('Auxiliary')) {
        if (term.text) {
          verbTerms.push(term.text);
        }
        continue;
      }

      // Preserve adverbs between auxiliary and lexical verb, e.g.:
      // "has quickly run diagnostics"
      if (tags.includes('Adverb') && verbTerms.length > 0) {
        const nextTags = normalizeTags(terms[i + 1]?.tags);
        if (nextTags.includes('Verb') || nextTags.includes('Auxiliary')) {
          if (term.text) {
            verbTerms.push(term.text);
          }
          continue;
        }
      } else {
        break;
      }

      break;
    }

    // Extract object (noun phrases after verb)
    const objectTerms: string[] = [];
    for (let i = verbIndex + verbTerms.length; i < terms.length; i++) {
      const term = terms[i];
      if (!term) continue;
      if (term.text) {
        objectTerms.push(term.text);
      }
    }

    // Only add if we have all three components
    if (subjectTerms.length > 0 && verbTerms.length > 0 && objectTerms.length > 0) {
      triples.push({
        subject: subjectTerms.join(' ').trim(),
        verb: verbTerms.join(' ').trim(),
        object: objectTerms.join(' ').trim(),
      });
    }
  }

  return triples;
}

/**
 * Extracts discourse markers from text with their position and type classification.
 *
 * @param text - The input text to analyze
 * @returns Array of discourse markers with position and type
 *
 * @example
 * ```ts
 * extractDiscourseMarkers('However, the market changed. We therefore adapted.');
 * // => [
 * //   { marker: 'however', position: 'start', type: 'contrast' },
 * //   { marker: 'therefore', position: 'middle', type: 'causal' }
 * // ]
 * ```
 */
export function extractDiscourseMarkers(text: string): DiscourseMarker[] {
  const markers: DiscourseMarker[] = [];
  const doc = nlp(text);
  const sentences = doc.sentences();

  for (const sentence of sentences.json()) {
    const sentenceText = (sentence.text as string).toLowerCase();
    const terms = (sentence.terms || []) as Array<{ text: string }>;
    const termTexts = terms.map((t) => t.text.toLowerCase());

    // Check for multi-word markers first
    for (const marker of MULTI_WORD_MARKERS) {
      const index = sentenceText.indexOf(marker);
      if (index !== -1) {
        const type = DISCOURSE_MARKERS[marker] || 'unknown';
        let position: 'start' | 'middle' | 'end' = 'middle';

        if (index === 0 || sentenceText.substring(0, index).trim().length === 0) {
          position = 'start';
        } else if (index + marker.length >= sentenceText.length - 5) {
          position = 'end';
        }

        markers.push({ marker, position, type });
      }
    }

    // Check for single-word markers
    for (let i = 0; i < termTexts.length; i++) {
      const term = termTexts[i];
      if (!term) continue;

      // Clean the term for matching
      const cleanTerm = term.replace(/[^a-z]/g, '');
      if (DISCOURSE_MARKERS[cleanTerm]) {
        const type = DISCOURSE_MARKERS[cleanTerm] || 'unknown';
        let position: 'start' | 'middle' | 'end' = 'middle';

        if (i === 0) {
          position = 'start';
        } else if (i >= termTexts.length - 2) {
          position = 'end';
        }

        markers.push({ marker: cleanTerm, position, type });
      }
    }
  }

  // Remove duplicates based on marker text
  const seen = new Set<string>();
  return markers.filter((m) => {
    if (seen.has(m.marker)) return false;
    seen.add(m.marker);
    return true;
  });
}

/**
 * Maps compromise tags to simplified POS categories.
 */
const POS_TAG_MAP: Record<string, string> = {
  Noun: 'NOUN',
  Singular: 'NOUN',
  Plural: 'NOUN',
  ProperNoun: 'NOUN',
  Person: 'NOUN',
  Place: 'NOUN',
  Organization: 'NOUN',
  Verb: 'VERB',
  PresentTense: 'VERB',
  PastTense: 'VERB',
  FutureTense: 'VERB',
  Auxiliary: 'AUX',
  Copula: 'VERB',
  Adjective: 'ADJ',
  Comparative: 'ADJ',
  Superlative: 'ADJ',
  Adverb: 'ADV',
  Preposition: 'PREP',
  Determiner: 'DET',
  Conjunction: 'CONJ',
  Pronoun: 'PRON',
  Modal: 'MODAL',
  Possessive: 'POSS',
  Value: 'NUM',
  Number: 'NUM',
  Date: 'DATE',
  Percent: 'NUM',
  Currency: 'NUM',
  QuestionWord: 'WH',
  Expression: 'EXP',
  Url: 'URL',
  Email: 'EMAIL',
  PhoneNumber: 'PHONE',
  HashTag: 'HASH',
  AtMention: 'MENTION',
};

const POS_PRIORITY: Record<string, number> = {
  PRON: 1,
  VERB: 2,
  AUX: 3,
  ADJ: 4,
  ADV: 5,
  PREP: 6,
  DET: 7,
  CONJ: 8,
  NUM: 9,
  DATE: 10,
  WH: 11,
  NOUN: 12,
  UNK: 99,
};

const DEFAULT_POS_PRIORITY = 99;

function normalizeTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags.filter((tag): tag is string => typeof tag === 'string');
  }
  if (rawTags && typeof rawTags === 'object') {
    return Object.keys(rawTags as Record<string, unknown>);
  }
  return [];
}

function selectBestPos(tags: string[]): string {
  const mapped = tags
    .map(tag => POS_TAG_MAP[tag])
    .filter((tag): tag is string => Boolean(tag));

  if (mapped.length === 0) {
    return 'UNK';
  }

  // O(n) linear scan instead of O(n log n) sort
  let best = mapped[0]!;
  let bestPriority = POS_PRIORITY[best] ?? DEFAULT_POS_PRIORITY;

  for (let i = 1; i < mapped.length; i++) {
    const tag = mapped[i]!;
    const priority = POS_PRIORITY[tag] ?? DEFAULT_POS_PRIORITY;
    if (priority < bestPriority) {
      best = tag;
      bestPriority = priority;
    }
  }

  return best;
}

/**
 * Checks if the text matches a given POS pattern.
 *
 * @param text - The input text to analyze
 * @param pattern - Array of POS tags to match (e.g., ['NOUN', 'VERB', 'NOUN'])
 * @returns true if the text matches the POS pattern
 *
 * @example
 * ```ts
 * hasPOSPattern('The dog runs fast', ['NOUN', 'VERB', 'ADV']);
 * // => true
 * hasPOSPattern('Beautiful day', ['ADJ', 'NOUN']);
 * // => true
 * ```
 */
export function hasPOSPattern(text: string, pattern: string[]): boolean {
  if (!pattern || pattern.length === 0) return false;
  const textPattern = getPOSPattern(text);

  if (textPattern.length < pattern.length) return false;

  // Check if pattern matches anywhere in the text pattern
  for (let i = 0; i <= textPattern.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (textPattern[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }

  return false;
}

/**
 * Extracts the POS pattern for a sentence.
 *
 * @param text - The input text to analyze
 * @returns Array of simplified POS tags
 *
 * @example
 * ```ts
 * getPOSPattern('The quick brown fox jumps.');
 * // => ['DET', 'ADJ', 'ADJ', 'NOUN', 'VERB']
 * ```
 */
export function getPOSPattern(text: string): string[] {
  const doc = nlp(text);
  const sentences = doc.sentences().json() || [];
  const terms = sentences.flatMap((s: any) => s.terms || []);
  const pattern: string[] = [];

  for (const term of terms) {
    const tags = normalizeTags(term.tags);
    pattern.push(selectBestPos(tags));
  }

  return pattern;
}

/**
 * Checks if text is grammatically complete using compromise.
 * A complete sentence has: subject (noun/pronoun) + verb + proper ending.
 *
 * @param text - The input text to analyze
 * @returns true if the text appears grammatically complete
 *
 * @example
 * ```ts
 * isGrammaticallyComplete('The company launched a new product.');
 * // => true
 * isGrammaticallyComplete('Launching new');
 * // => false
 * ```
 */
export function isGrammaticallyComplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const doc = nlp(trimmed);
  const sentences = doc.sentences();

  if (sentences.length === 0) return false;

  const sentence = sentences.json()[0];
  if (!sentence) return false;

  const terms = sentence.terms || [];
  if (terms.length < 2) return false;

  // Check for verb presence
  const hasVerb = terms.some((term: { tags?: string[] }) =>
    normalizeTags(term.tags).some((tag) => tag === 'Verb' || tag === 'Copula' || tag === 'Auxiliary')
  );

  if (!hasVerb) return false;

  // Check for subject (noun or pronoun before verb)
  let hasSubject = false;
  let foundVerb = false;

  for (const term of terms) {
    const tags = normalizeTags(term.tags);
    if (!foundVerb && (tags.includes('Verb') || tags.includes('Copula'))) {
      foundVerb = true;
    }
    if (!foundVerb && (tags.includes('Noun') || tags.includes('Pronoun') || tags.includes('ProperNoun'))) {
      hasSubject = true;
    }
  }

  // Check for proper ending punctuation
  const lastChar = trimmed[trimmed.length - 1];
  const hasProperEnding = lastChar === '.' || lastChar === '!' || lastChar === '?';
  if (hasSubject && hasVerb && hasProperEnding) {
    return true;
  }

  // Handle common question form with auxiliary before subject:
  // "What is your name?"
  if (lastChar === '?') {
    const hasQuestionWord = terms.some((term: { tags?: unknown }) =>
      normalizeTags(term.tags).includes('QuestionWord')
    );
    const hasPronounOrNoun = terms.some((term: { tags?: unknown }) => {
      const tags = normalizeTags(term.tags);
      return tags.includes('Pronoun') || tags.includes('Noun') || tags.includes('ProperNoun');
    });
    return hasQuestionWord && hasVerb && hasPronounOrNoun;
  }

  return false;
}

/**
 * Options for keyword extraction.
 */
export interface KeywordExtractionOptions {
  /** Maximum number of keywords to return (default: 10) */
  maxKeywords?: number;
}

/**
 * Extracts keywords from text using compromise noun phrases and frequency analysis.
 * Implements a YAKE!-like heuristic based on frequency, position, and term properties.
 *
 * @param text - The input text to analyze
 * @param options - Optional configuration for keyword extraction
 * @returns Array of extracted keywords sorted by relevance
 *
 * @example
 * ```ts
 * extractKeywords('Machine learning transforms data science dramatically.');
 * // => ['machine learning', 'data science', 'transforms']
 * ```
 */
export function extractKeywords(text: string, options: KeywordExtractionOptions = {}): string[] {
  const { maxKeywords = 10 } = options;
  const doc = nlp(text);

  // Extract nouns for keyword analysis
  const nouns = doc.nouns().out('array') as string[];

  // NOTE: compromise v14.x does not have a nounPhrases() method.
  // Multi-word phrase extraction is handled by extractKeyPhrases in keyphrases.ts
  // for the verification path. For NLP-enhanced scoring, single-word nouns
  // combined with frequency analysis provides sufficient signal.
  // TODO: Re-evaluate when upgrading to compromise v15+ or replacing with
  // a more capable NLP library with proper noun phrase extraction.
  const nounPhrases: string[] = [];

  // Extract all terms for frequency analysis
  const sentences = doc.json() || [];
  const terms = sentences.flatMap((s: any) => s.terms || []);
  const wordFreq = new Map<string, number>();
  const wordPositions = new Map<string, number[]>();

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (!term || !term.text) continue;

    const word = term.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (word.length < 3) continue;

    // Use shared STOPWORDS and GENERIC_TERMS from keyphrases.ts
    // This ensures domain-agnostic filtering per plan-006 principles
    if (STOPWORDS.has(word) || GENERIC_TERMS.has(word)) continue;

    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);

    const positions = wordPositions.get(word) || [];
    positions.push(i);
    wordPositions.set(word, positions);
  }

  // Calculate scores for all candidates
  interface KeywordCandidate {
    term: string;
    score: number;
  }

  const candidates: KeywordCandidate[] = [];

  // Normalize noun phrases for case-insensitive matching
  const nounPhrasesLower = new Set(nounPhrases.map(p => p.toLowerCase().trim()));

  // Score noun phrases higher
  const allTerms = new Set([...nounPhrases, ...nouns, ...wordFreq.keys()]);

  for (const term of allTerms) {
    const normalizedTerm = term.toLowerCase().trim();
    if (normalizedTerm.length < 3) continue;

    let score = 0;

    // Noun phrases get a base score boost
    if (nounPhrasesLower.has(normalizedTerm)) {
      score += 2;
    }

    // Frequency score (normalized)
    const freq = wordFreq.get(normalizedTerm) || 1;
    const positions = wordPositions.get(normalizedTerm) || [0];
    score += Math.min(freq * 0.5, 3);

    // Position score (terms appearing earlier get higher scores)
    const avgPosition = positions.reduce((a, b) => a + b, 0) / positions.length;
    const positionScore = Math.max(0, 1 - avgPosition / terms.length);
    score += positionScore * 2;

    // Length score (longer terms often more specific)
    score += Math.min(normalizedTerm.split(' ').length * 0.5, 1.5);

    candidates.push({ term: normalizedTerm, score });
  }

  // Sort by score and return top keywords
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, maxKeywords).map((c) => c.term);
}

/**
 * Common boilerplate POS patterns found in sponsor segments and CTAs.
 *
 * NOTE: These patterns use IMPERATIVE-ANCHORED matching (must start at sentence beginning)
 * to avoid false positives on legitimate claims. Generic sliding-window patterns were
 * removed because they incorrectly penalized domain content like:
 * - "Studies support the link between X and Y" → matched ['VERB', 'DET', 'NOUN']
 * - "The mechanism introduces a key signal" → matched ['VERB', 'DET', 'NOUN']
 *
 * Only highly-specific CTA patterns are retained here.
 */
const BOILERPLATE_PATTERNS: string[][] = [
  // "Subscribe and hit the bell" - imperative verb + conjunction + verb
  ['VERB', 'CONJ', 'VERB'],
  // "Thanks for watching" - gratitude noun + preposition + gerund
  ['NOUN', 'PREP', 'VERB'],
  // "This video is sponsored by" - specific declarative pattern
  ['DET', 'NOUN', 'VERB', 'VERB', 'PREP'],
];

/**
 * CTA-specific keywords for sponsor/affiliate detection.
 *
 * NOTE: Tightened to avoid false positives on legitimate domain claims.
 * Removed domain-agnostic words like 'link', 'support', 'check', 'visit', 'channel'
 * which appear in valid content across domains.
 *
 * Retained only words with strong CTA specificity:
 * - Platform-specific: patreon, merch, affiliate, referral
 * - Action-specific: subscribe (as engagement CTA, not verb use), promo, discount
 */
const BOILERPLATE_KEYWORDS = new Set([
  'sponsor',
  'sponsored',
  'ad',
  'advertisement',
  'promo',
  'discount',
  'subscribe', // Engagement CTA context
  'patreon',
  'merch',
  'store',
  'buy',
  'purchase',
  'affiliate',
  'referral',
  'thanks', // In outro context
  'thank', // In outro context
  'watching', // In "thanks for watching"
]);

/**
 * Pre-compiled regex patterns for boilerplate keyword detection.
 * Compiled once at module load to avoid repeated regex compilation in hot path.
 */
const BOILERPLATE_KEYWORD_REGEXES = Array.from(BOILERPLATE_KEYWORDS).map((keyword) => {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
});

/**
 * Pre-compiled regex for detecting CTA structural markers in imperative sentences.
 * Compiled once at module load to avoid repeated regex compilation in hot path.
 *
 * These markers indicate strong CTA intent when combined with imperative verb patterns:
 * - Second-person pronouns (your, our) indicate direct address to user
 * - Directional words (below) indicate CTA positioning
 * - Time/urgency markers (for more, today, now) indicate call-to-action urgency
 */
const CTA_MARKERS_REGEX = /\b(your|our|below|for more|today|now)\b/i;

/**
 * Detects if text contains boilerplate POS patterns typical of sponsor segments or CTAs.
 *
 * Uses a dual-layer approach to minimize false positives on legitimate domain claims:
 * 1. CTA-specific keyword detection (tightened to avoid domain-agnostic terms)
 * 2. Imperative sentence pattern detection (must start with verb)
 *
 * @param text - The input text to analyze
 * @returns true if the text matches common boilerplate patterns
 *
 * @example
 * ```ts
 * hasBoilerplatePOSPattern('Check out our sponsor today.');
 * // => true
 * hasBoilerplatePOSPattern('The economic analysis reveals new insights.');
 * // => false
 * ```
 */
export function hasBoilerplatePOSPattern(text: string): boolean {
  const normalizedText = text.toLowerCase();
  const doc = nlp(text);
  const pattern = getPOSPattern(text);

  // Check for boilerplate keywords using pre-compiled regex patterns
  const hasBoilerplateKeyword = BOILERPLATE_KEYWORD_REGEXES.some((regex) =>
    regex.test(normalizedText)
  );

  // Check for common POS patterns (Anchored to start)
  const hasBoilerplatePattern = BOILERPLATE_PATTERNS.some((boilerPattern) => {
    if (pattern.length < boilerPattern.length) return false;

    // Must start at index 0 (anchored)
    let match = true;
    for (let j = 0; j < boilerPattern.length; j++) {
      if (pattern[j] !== boilerPattern[j]) {
        match = false;
        break;
      }
    }
    return match;
  });

  // Check for imperative sentence patterns (common in CTAs)
  // This is the primary signal: CTAs almost always start with imperative verbs
  const sentences = doc.sentences().json();
  const hasImperativePattern = sentences.some((sentence: { terms?: Array<{ tags: string[]; text: string }> }) => {
    const terms = sentence.terms || [];
    if (terms.length === 0) return false;

    // Check if sentence starts with a verb (imperative mood)
    const firstTerm = terms[0];
    if (!firstTerm) return false;

    const firstTags = normalizeTags(firstTerm.tags);
    return firstTags.includes('Verb') && !firstTags.includes('Pronoun');
  });

  // Require BOTH keyword AND pattern/imperative match to reduce false positives
  // This prevents "Studies support the link..." from triggering due to generic keywords
  //
  // Exception: Strong imperative patterns (verb-first sentences) with certain structural
  // markers are sufficient even without explicit keywords. This catches CTAs like
  // "Click the link below" and "Visit our website" without requiring those common
  // words in the keyword blacklist (which would cause false positives on legitimate content).
  const hasStrongImperativeCTA = hasImperativePattern && CTA_MARKERS_REGEX.test(normalizedText);

  if (hasStrongImperativeCTA) {
    return true;
  }

  return hasBoilerplateKeyword && (hasBoilerplatePattern || hasImperativePattern);
}
