/**
 * Shared constants for editorial processing.
 */

/**
 * Patterns for detecting low-value boilerplate content in transcripts.
 * Includes sponsor CTAs, ad-read patterns, and generic intro/outro phrases.
 *
 * Note: Patterns are kept specific to avoid false positives on legitimate content.
 * For example, "limited time" alone is too broad (could match "limited time window"),
 * but "limited time only" or "limited time offer" are clear CTA markers.
 */
export const BOILERPLATE_PATTERNS = [
  /\bsubscribe\b/i,
  /like and subscribe/i,
  /smash that (like|subscribe)/i,
  /\bsponsor\b/i,
  /patreon/i,
  /thanks for watching/i,
  /welcome back/i,
  /\bintro\b/i,
  /\boutro\b/i,
  // Common ad-read patterns (more specific to avoid false positives)
  /\bspecial offer\b/i,
  /\bdiscount code\b/i,
  /\bpromo code\b/i,
  /\buse code [A-Z0-9_-]{3,}\b/i,
  /\blinked (?:below|down below)\b/i,
  /\blink (?:below|down below|in the description)\b/i,
  /\baffiliate link\b/i,
  /\bsupport the (channel|show|podcast)\b/i,
  /\bclick (the link|link below|down below)\b/i,
  /\bcheck out (the description|below|my link)\b/i,
  /\bfollow me on\b/i,
  /\bjoin the (discord|community|patreon)\b/i,
  /\byou can earn \d+(?:\.\d+)?%\s+apy\b/i,
  /\bpartner banks?\b/i,
  /\bwealthfront\b/i,
];

/**
 * Conjunctions that indicate dangling sentence boundaries.
 */
export const CONJUNCTION_ENDINGS = ['and', 'but', 'so', 'or', 'then'] as const;

/**
 * Filler words that indicate hesitation in speech.
 */
export const FILLER_PATTERNS = [/\buh\b/gi, /\bum\b/gi] as const;

/**
 * Pronouns that indicate decontextualized fragments when they start a claim.
 */
export const CONTEXT_DEPENDENT_PRONOUNS = [
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'they',
  'them',
  'their',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'we',
  'us',
  'our',
  'you',
  'your',
] as const;

/**
 * Markers for action verbs that indicate actionable claims.
 */
export const ACTION_MARKERS = [
  'do',
  'avoid',
  'use',
  'try',
  'stop',
  'start',
  'increase',
  'decrease',
  'step',
  'rule',
  'create',
  'set',
  'measure',
  'track',
] as const;

/**
 * Step-related patterns in instructional content.
 */
export const STEP_PATTERNS = [
  /\bstep\s+\d+\b/i,
  /\bfirst\b/i,
  /\bthen\b/i,
  /\bnext\b/i,
  /\bfinally\b/i,
] as const;

/**
 * Number and unit patterns for identifying specific claims.
 */
export const NUMBER_OR_UNIT_PATTERN = /\b\d+(?:\.\d+)?(?:%|mg|g|kg|ml|l|hour|hours|min|minute|minutes|sec|seconds)?\b/i;

/**
 * Pattern for detecting all-caps tokens (often acronyms or shouting).
 */
export const ALL_CAPS_TOKEN_PATTERN = /^[A-Z]{2,}$/;

/**
 * Metadata keys for claim metadata.
 */
export const CLAIM_METADATA_KEYS = {
  START_SECONDS: 'startSeconds',
  TYPE: 'type',
  CLASSIFICATION: 'classification',
  DOMAIN: 'domain',
  EVIDENCE_TYPE: 'evidenceType',
  WHY: 'why',
  MODEL: 'model',
  PROMPT_VERSION: 'promptVersion',
  ECHO_OVERLAP_RATIO: 'echoOverlapRatio',
  CONFIDENCE: 'confidence',
  METHOD: 'method',
  EDITOR_VERSION: 'editorVersion',
  EXTRACTOR_VERSION: 'extractorVersion',
} as const;

/**
 * Scoring weights for editorial pass v2.
 */
export const EDITORIAL_V2_WEIGHTS = {
  CONFIDENCE: 0.20,
  LENGTH: 0.10,
  ACTIONABILITY: 0.25,
  SPECIFICITY: 0.15,
  EVIDENCE: 0.15,
  DOMAIN_BONUS: 0.15,
  CLASSIFICATION_BONUS: 0.10,
  EVIDENCE_TYPE_BONUS: 0.10,
  PRONOUN_FRAGMENT_PENALTY: 0.15,
} as const;
