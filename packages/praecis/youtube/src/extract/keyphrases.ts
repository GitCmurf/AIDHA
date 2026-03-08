/**
 * Keyphrase extraction utilities used by semantic verification.
 *
 * The extractor favors deterministic, low-cost heuristics and avoids
 * high-maintenance lexical allowlists.
 */

/**
 * Stopwords to exclude from keyphrase extraction.
 * Domain-agnostic common function words.
 */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
  'from', 'into', 'onto', 'over', 'under', 'it', 'its', 'their', 'our',
]);

/**
 * Ultra-generic terms that weakly discriminate meaning across domains.
 * Per plan-006 policy: max 100 entries, changes require benchmark-linked rationale.
 */
export const GENERIC_TERMS = new Set([
  'analysis', 'approach', 'assessment', 'case', 'category', 'claim', 'component',
  'concept', 'condition', 'context', 'data', 'decision', 'description', 'detail',
  'development', 'difference', 'discussion', 'effect', 'element', 'evidence',
  'example', 'factor', 'feature', 'finding', 'focus', 'framework', 'function',
  'general', 'goal', 'group', 'guideline', 'idea', 'impact', 'information',
  'insight', 'instance', 'issue', 'item', 'knowledge', 'level', 'method',
  'model', 'number', 'outcome', 'overview', 'parameter', 'pattern', 'point',
  'position', 'practice', 'principle', 'problem', 'process', 'program',
  'project', 'question', 'range', 'rate', 'reason', 'report', 'research',
  'result', 'results', 'review', 'role', 'scope', 'section', 'significant',
  'situation', 'stage', 'standard', 'state', 'step', 'strategy', 'structure',
  'study', 'subject', 'summary', 'system', 'target', 'term', 'theory',
  'topic', 'trend', 'type', 'understanding', 'value', 'variable', 'view',
  'way', 'work', 'shows',
]);

/** Maximum curated cap for GENERIC_TERMS to prevent scope creep. */
export const GENERIC_TERMS_MAX = 100;

const PROPER_NOUN_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const TOKEN_PATTERN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;

/**
 * Normalizes a word by lowercasing and stripping leading/trailing non-alphanumeric chars.
 * Uses simple string operations to avoid ReDoS vulnerabilities from complex regex.
 */
function normalizeWord(raw: string): string {
  const lower = raw.toLowerCase();
  let start = 0;
  let end = lower.length;

  // Find first alphanumeric character
  while (start < end && !isAlphaNumeric(lower[start]!)) {
    start++;
  }

  // Find last alphanumeric character
  while (end > start && !isAlphaNumeric(lower[end - 1]!)) {
    end--;
  }

  return lower.slice(start, end);
}

/**
 * Checks if a character is alphanumeric (a-z, 0-9).
 * Inline for performance to avoid regex overhead.
 */
function isAlphaNumeric(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 97 && code <= 122)   // a-z
  );
}

function isAcronym(raw: string): boolean {
  return /^[A-Z]{2,}[A-Z0-9-]*$/.test(raw);
}

function isCandidateTerm(normalized: string, raw: string): boolean {
  const acronym = isAcronym(raw);
  const longEnough = normalized.length >= 4;
  return (acronym || longEnough)
    && !STOPWORDS.has(normalized)
    && !GENERIC_TERMS.has(normalized);
}

/**
 * Extracts key phrases (proper nouns and non-generic salient terms) from text.
 *
 * @param text - The text to extract phrases from
 * @returns Array of extracted key phrases
 */
export function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];

  const properNouns = text.match(PROPER_NOUN_PATTERN);
  if (properNouns) {
    phrases.push(...properNouns.map(phrase => phrase.toLowerCase()));
  }

  const rawTokens = text.match(TOKEN_PATTERN) ?? [];
  const tokens = rawTokens
    .map(raw => ({ raw, normalized: normalizeWord(raw) }))
    .filter(token => token.normalized.length > 0);

  const candidateTokens = tokens.filter(token => isCandidateTerm(token.normalized, token.raw));
  phrases.push(...candidateTokens.map(token => token.normalized));

  for (let i = 1; i < tokens.length; i++) {
    const left = tokens[i - 1];
    const right = tokens[i];
    if (left && right && isCandidateTerm(left.normalized, left.raw) && isCandidateTerm(right.normalized, right.raw)) {
      phrases.push(`${left.normalized} ${right.normalized}`);
    }
  }

  return Array.from(new Set(phrases));
}
