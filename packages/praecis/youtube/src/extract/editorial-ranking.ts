import type { ClaimCandidate } from './types.js';
import { clamp, normalizeText, normalizeKey, uniqueSortedStrings } from './utils.js';
import { calculateTokenOverlap } from './verification.js';
import {
  BOILERPLATE_PATTERNS,
  ACTION_MARKERS,
  STEP_PATTERNS,
  CONJUNCTION_ENDINGS,
  FILLER_PATTERNS,
  CONTEXT_DEPENDENT_PRONOUNS,
  NUMBER_OR_UNIT_PATTERN,
  ALL_CAPS_TOKEN_PATTERN,
  EDITORIAL_V2_WEIGHTS,
} from './constants.js';

const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_MAX_PER_WINDOW = 3;
const DEFAULT_MIN_WINDOWS = 4;
const DEFAULT_V2_MIN_WORDS = 8;
const DEFAULT_V2_MIN_CHARS = 50;
const DEFAULT_V2_DEDUPE_OVERLAP = 0.8;
const DEFAULT_V2_SEMANTIC_SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_V2_BOILERPLATE_PENALTY = 0.55;
const DEFAULT_V2_FRAGMENT_PENALTY = 0.5;
const DEFAULT_V2_DROP_THRESHOLD = 0.2;
const DEFAULT_V2_ECHO_OVERLAP_THRESHOLD = 0.9;

/**
 * Echo detection mode controls how transcript echoes are handled.
 * - 'off': Disable echo detection entirely
 * - 'tag': Calculate and tag claims with overlap ratio (preserves all claims)
 */
export type EchoDetectionMode = 'off' | 'tag';

/**
 * Default echo detection configuration.
 * Used when caller doesn't provide explicit settings.
 */
export const DEFAULT_ECHO_DETECTION: Readonly<{
  mode: EchoDetectionMode;
  overlapThreshold: number;
}> = Object.freeze({
  mode: 'tag' as const,
  overlapThreshold: 0.9,
});

export type EditorialDropReason =
  | 'empty'
  | 'boilerplate'
  | 'fragment'
  | 'duplicate'
  | 'coverage';

export interface EditorialDiagnostics {
  editorVersion: 'v1' | 'v2';
  totalCandidates: number;
  selectedCount: number;
  droppedCounts: Record<EditorialDropReason, number>;
  windowCoverage: Array<{ windowIndex: number; selectedCount: number }>;
  /** Count of claims tagged as transcript echoes (overlap ≥ threshold) */
  echoTaggedCount: number;
  /** Count of claims analyzed for echo (including zero overlap ratio) */
  echoAnalyzedCount: number;
}

export interface EditorialPassV1Options {
  maxClaims: number;
  chunkCount: number;
}

export interface EditorialPassV2Options {
  maxClaims: number;
  chunkCount: number;
  windowMinutes?: number;
  maxPerWindow?: number;
  minWindows?: number;
  minWords?: number;
  minChars?: number;
  dedupeOverlapThreshold?: number;
  semanticSimilarityThreshold?: number;
  boilerplatePenalty?: number;
  fragmentPenalty?: number;
  dropThreshold?: number;
  excerptTextLengthById?: Map<string, number>;
  excerptTextsById?: Map<string, string>;
  /**
   * Echo detection configuration.
   * - mode: 'off' to disable, 'tag' to calculate overlap without penalizing
   * - overlapThreshold: minimum overlap ratio to consider a claim an "echo" (default 0.9)
   */
  echoDetection?: {
    mode?: EchoDetectionMode;
    overlapThreshold?: number;
  };
}

interface ScoredCandidate {
  candidate: ClaimCandidate;
  score: number;
  windowIndex: number;
}

interface DedupeResult {
  deduped: ClaimCandidate[];
  duplicateCount: number;
}

/**
 * Calculates token overlap ratio between two strings.
 * Uses Jaccard similarity (intersection / union) via calculateTokenOverlap.
 * Delegates to the verification module which implements the actual computation.
 */
function tokenOverlapRatio(str1: string, str2: string): number {
  return calculateTokenOverlap(str1, str2);
}

/**
 * Calculates the maximum token overlap ratio between a claim and its source excerpts.
 * Returns a value between 0 and 1, where higher values indicate more similarity to the transcript.
 * Returns undefined if no excerpt texts are available or the claim is too short to analyze.
 *
 * This helps distinguish between:
 * - High ratios (>0.9): Near-exact transcript copies ("echoes")
 * - Medium ratios (0.5-0.9): Partially rewritten claims
 * - Low ratios (<0.5): Highly synthesized/assertions
 */
function calculateEchoOverlapRatio(
  candidate: ClaimCandidate,
  excerptTexts: Map<string, string>
): number | undefined {
  const normalizedClaim = normalizeText(candidate.text).toLowerCase();
  if (normalizedClaim.length < 20) return undefined; // Short claims can't reliably be analyzed

  let maxOverlap = 0;
  let hasExcerpt = false;
  for (const excerptId of candidate.excerptIds) {
    const excerptText = excerptTexts.get(excerptId);
    if (excerptText) {
      hasExcerpt = true;
      const overlap = tokenOverlapRatio(normalizedClaim, excerptText);
      maxOverlap = Math.max(maxOverlap, overlap);
    }
  }

  return hasExcerpt ? maxOverlap : undefined;
}

function stableExcerptKey(candidate: ClaimCandidate): string {
  return uniqueSortedStrings(candidate.excerptIds).join('|');
}

function candidateStart(candidate: ClaimCandidate): number {
  return typeof candidate.startSeconds === 'number' ? candidate.startSeconds : Number.MAX_SAFE_INTEGER;
}

function compareScoredCandidatePriority(a: ScoredCandidate, b: ScoredCandidate): number {
  const scoreDiff = b.score - a.score;
  if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
  const startDiff = candidateStart(a.candidate) - candidateStart(b.candidate);
  if (startDiff !== 0) return startDiff;
  const textDiff = a.candidate.text.localeCompare(b.candidate.text);
  if (textDiff !== 0) return textDiff;
  return stableExcerptKey(a.candidate).localeCompare(stableExcerptKey(b.candidate));
}

function compareCandidateOutputOrder(a: ClaimCandidate, b: ClaimCandidate): number {
  const startDiff = candidateStart(a) - candidateStart(b);
  if (startDiff !== 0) return startDiff;
  const textDiff = a.text.localeCompare(b.text);
  if (textDiff !== 0) return textDiff;
  return stableExcerptKey(a).localeCompare(stableExcerptKey(b));
}

function isLowValue(text: string): boolean {
  return BOILERPLATE_PATTERNS.some(pattern => pattern.test(text));
}

function isTooShortV1(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return trimmed.length < 40 || words < 6;
}

function endsWithConjunction(text: string): boolean {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.toLowerCase();
  if (!lastWord) return false;
  return (CONJUNCTION_ENDINGS as readonly string[]).includes(lastWord);
}

function hasTooMuchFiller(text: string): boolean {
  let fillerCount = 0;
  for (const pattern of FILLER_PATTERNS) {
    const matches = text.match(pattern);
    fillerCount += matches?.length ?? 0;
  }
  return fillerCount >= 3;
}

function isTooShortV2(text: string, minWords: number, minChars: number): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (trimmed.length < minChars || words < minWords) return true;
  if (endsWithConjunction(trimmed)) return true;
  if (trimmed.includes('...')) return true;
  if (hasTooMuchFiller(trimmed)) return true;
  return false;
}

/**
 * Detects if a claim starts with a context-dependent pronoun.
 * These claims are often fragments that lack clear antecedents.
 */
function startsWithPronoun(text: string): boolean {
  const normalized = normalizeText(text);
  const firstWord = normalized.split(/\s+/)[0]?.toLowerCase();
  if (!firstWord) return false;

  // Check for pronouns that indicate missing context
  if ((CONTEXT_DEPENDENT_PRONOUNS as readonly string[]).includes(firstWord)) {
    return true;
  }

  // Check for "which" or "who" clauses (relative pronouns starting fragments)
  if (firstWord === 'which' || firstWord === 'who' || firstWord === 'whose') {
    return true;
  }

  return false;
}

function excerptOverlapRatio(a: ClaimCandidate, b: ClaimCandidate): number {
  const aSet = new Set(a.excerptIds);
  const bSet = new Set(b.excerptIds);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const id of aSet) {
    if (bSet.has(id)) intersection += 1;
  }
  const denominator = Math.min(aSet.size, bSet.size);
  if (denominator === 0) return 0;
  return intersection / denominator;
}

function shouldMergeCandidates(a: ClaimCandidate, b: ClaimCandidate, overlapThreshold: number): boolean {
  if (normalizeKey(a.text) === normalizeKey(b.text)) return true;
  return excerptOverlapRatio(a, b) >= overlapThreshold;
}

function dedupeCandidates(
  candidates: ClaimCandidate[],
  comparePriority: (a: ClaimCandidate, b: ClaimCandidate) => number,
  overlapThreshold: number
): DedupeResult {
  const ranked = candidates.slice().sort(comparePriority);
  const deduped: ClaimCandidate[] = [];
  let duplicateCount = 0;

  for (const candidate of ranked) {
    const existingIndex = deduped.findIndex(existing =>
      shouldMergeCandidates(existing, candidate, overlapThreshold)
    );
    if (existingIndex === -1) {
      deduped.push(candidate);
      continue;
    }

    duplicateCount += 1;
    const existing = deduped[existingIndex];
    if (existing && comparePriority(candidate, existing) < 0) {
      deduped[existingIndex] = candidate;
    }
  }

  return { duplicateCount, deduped: deduped.sort(compareCandidateOutputOrder) };
}


/**
 * Performs semantic deduplication to catch paraphrased claims that escape exact matching.
 * Uses token set Jaccard similarity to identify claims with similar meaning but different wording.
 *
 * Performance: Pre-tokenizes all candidates once to avoid repeated Set allocation in O(n²) loop.
 * For 144 candidates with ~50 tokens each, this reduces ~20,000 Set allocations to just 144.
 */
function semanticDedupe(
  candidates: ClaimCandidate[],
  comparePriority: (a: ClaimCandidate, b: ClaimCandidate) => number,
  semanticThreshold: number
): DedupeResult {
  const ranked = candidates.slice().sort(comparePriority);

  // Pre-tokenize all candidates once to avoid repeated Set creation
  const tokenSets = new Map<ClaimCandidate, Set<string>>();
  for (const c of ranked) {
    tokenSets.set(c, new Set(normalizeText(c.text).toLowerCase().split(/\s+/).filter(Boolean)));
  }

  const deduped: ClaimCandidate[] = [];
  let duplicateCount = 0;

  for (const candidate of ranked) {
    const candidateTokens = tokenSets.get(candidate)!;
    const isDuplicate = deduped.some(existing => {
      const existingTokens = tokenSets.get(existing)!;
      if (candidateTokens.size === 0 || existingTokens.size === 0) return false;
      let intersect = 0;
      for (const t of candidateTokens) { if (existingTokens.has(t)) intersect++; }
      const union = candidateTokens.size + existingTokens.size - intersect;
      return (intersect / union) >= semanticThreshold;
    });

    if (isDuplicate) {
      duplicateCount++;
    } else {
      deduped.push(candidate);
    }
  }

  return { duplicateCount, deduped: deduped.sort(compareCandidateOutputOrder) };
}

function scoreCandidateV1(candidate: ClaimCandidate): number {
  const confidence = clamp(candidate.confidence ?? 0.6, 0, 1);
  const lengthScore = clamp((candidate.text.length ?? 0) / 180, 0, 1);
  return confidence * 0.7 + lengthScore * 0.3;
}

function actionabilityScore(text: string): number {
  const normalized = normalizeText(text).toLowerCase();
  const wordSet = new Set(normalized.split(/\s+/).filter(Boolean));
  let markers = 0;
  for (const marker of ACTION_MARKERS) {
    if (wordSet.has(marker)) markers += 1;
  }
  for (const pattern of STEP_PATTERNS) {
    if (pattern.test(normalized)) markers += 1;
  }
  return clamp(markers * 0.25, 0, 1);
}

function specificityScore(text: string): number {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let score = 0;
  if (NUMBER_OR_UNIT_PATTERN.test(normalized)) {
    score += 0.6;
  }

  const tailWords = words.slice(1);
  const capitalizedCount = tailWords.filter(word => /^[A-Z][a-z]/.test(word)).length;
  const allCapsCount = words.filter(word => ALL_CAPS_TOKEN_PATTERN.test(word)).length;
  const capitalizedRatio = tailWords.length > 0 ? capitalizedCount / tailWords.length : 0;
  const allCapsRatio = words.length > 0 ? allCapsCount / words.length : 0;

  if (allCapsRatio > 0.8) {
    score -= 0.2;
  } else if (capitalizedRatio >= 0.15) {
    score += 0.4;
  }

  return clamp(score, 0, 1);
}

function evidenceDensityScore(
  candidate: ClaimCandidate,
  excerptTextLengthById?: Map<string, number>
): number {
  const excerptCountScore = clamp(candidate.excerptIds.length / 3, 0, 1) * 0.5;
  if (!excerptTextLengthById || candidate.excerptIds.length === 0) {
    return excerptCountScore;
  }

  const totalLength = candidate.excerptIds.reduce(
    (sum, excerptId) => sum + (excerptTextLengthById.get(excerptId) ?? 0),
    0
  );
  const averageLength = totalLength / candidate.excerptIds.length;
  const lengthScore = clamp(averageLength / 160, 0, 1) * 0.5;
  return clamp(excerptCountScore + lengthScore, 0, 1);
}

function scoreCandidateV2(
  candidate: ClaimCandidate,
  options: {
    excerptTextLengthById?: Map<string, number>;
    boilerplatePenalty: number;
    fragmentPenalty: number;
    minWords: number;
    minChars: number;
  }
): number {
  const text = normalizeText(candidate.text);
  const confidence = clamp(candidate.confidence ?? 0.6, 0, 1);
  const lengthScore = clamp(text.length / 220, 0, 1);
  const actionScore = actionabilityScore(text);
  const specificity = specificityScore(text);
  const evidence = evidenceDensityScore(candidate, options.excerptTextLengthById);

  let score = (
    confidence * EDITORIAL_V2_WEIGHTS.CONFIDENCE +
    lengthScore * EDITORIAL_V2_WEIGHTS.LENGTH +
    actionScore * EDITORIAL_V2_WEIGHTS.ACTIONABILITY +
    specificity * EDITORIAL_V2_WEIGHTS.SPECIFICITY +
    evidence * EDITORIAL_V2_WEIGHTS.EVIDENCE
  );

  // Metadata richness bonus - favors claims with rich metadata matching Gemini baseline
  if (candidate.domain) {
    score += EDITORIAL_V2_WEIGHTS.DOMAIN_BONUS;
  }
  if (candidate.classification) {
    score += EDITORIAL_V2_WEIGHTS.CLASSIFICATION_BONUS;
  }
  if (candidate.evidenceType) {
    score += EDITORIAL_V2_WEIGHTS.EVIDENCE_TYPE_BONUS;
  }

  if (isLowValue(text)) {
    score -= options.boilerplatePenalty;
  }
  if (isTooShortV2(text, options.minWords, options.minChars)) {
    score -= options.fragmentPenalty;
  }

  // Context-dependent pronoun-led fragment penalty
  if (startsWithPronoun(text)) {
    score -= EDITORIAL_V2_WEIGHTS.PRONOUN_FRAGMENT_PENALTY;
  }

  return clamp(score, 0, 1);
}

function defaultDroppedCounts(): Record<EditorialDropReason, number> {
  return {
    empty: 0,
    boilerplate: 0,
    fragment: 0,
    duplicate: 0,
    coverage: 0,
  };
}

function buildWindowCoverage(
  selected: ClaimCandidate[],
  resolveWindowIndex: (candidate: ClaimCandidate) => number
): Array<{ windowIndex: number; selectedCount: number }> {
  const byWindow = new Map<number, number>();
  for (const candidate of selected) {
    const windowIndex = resolveWindowIndex(candidate);
    byWindow.set(windowIndex, (byWindow.get(windowIndex) ?? 0) + 1);
  }
  return Array.from(byWindow.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([windowIndex, selectedCount]) => ({ windowIndex, selectedCount }));
}

function selectV1DiverseCandidates(
  candidates: ClaimCandidate[],
  maxClaims: number,
  chunkCount: number
): ClaimCandidate[] {
  const scored: ScoredCandidate[] = candidates
    .map(candidate => ({ candidate, score: scoreCandidateV1(candidate), windowIndex: candidate.chunkIndex ?? -1 }))
    .sort(compareScoredCandidatePriority);

  const byChunk = new Map<number, ScoredCandidate[]>();
  for (const entry of scored) {
    const chunkIndex = entry.candidate.chunkIndex ?? -1;
    if (!byChunk.has(chunkIndex)) byChunk.set(chunkIndex, []);
    byChunk.get(chunkIndex)?.push(entry);
  }

  const selected: ClaimCandidate[] = [];
  for (let index = 0; index < chunkCount && selected.length < maxClaims; index++) {
    const bucket = byChunk.get(index);
    if (!bucket || bucket.length === 0) continue;
    const best = bucket.sort((a, b) => b.score - a.score)[0];
    if (best) selected.push(best.candidate);
  }

  for (const entry of scored) {
    if (selected.length >= maxClaims) break;
    if (selected.includes(entry.candidate)) continue;
    selected.push(entry.candidate);
  }

  return selected.slice(0, maxClaims).sort(compareCandidateOutputOrder);
}

function resolveWindowIndex(
  candidate: ClaimCandidate,
  windowSeconds: number
): number {
  if (typeof candidate.startSeconds === 'number' && Number.isFinite(candidate.startSeconds)) {
    return Math.floor(Math.max(0, candidate.startSeconds) / Math.max(1, windowSeconds));
  }
  return typeof candidate.chunkIndex === 'number' ? candidate.chunkIndex : -1;
}

function selectV2DiverseCandidates(
  scoredCandidates: ScoredCandidate[],
  options: EditorialPassV2Options
): ClaimCandidate[] {
  const maxClaims = options.maxClaims;
  const maxPerWindow = Math.max(1, options.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW);
  const minWindows = Math.max(1, options.minWindows ?? DEFAULT_MIN_WINDOWS);
  const windowSeconds = Math.max(
    60,
    Math.floor((options.windowMinutes ?? DEFAULT_WINDOW_MINUTES) * 60)
  );

  const byWindow = new Map<number, ScoredCandidate[]>();
  for (const entry of scoredCandidates) {
    const windowIndex = resolveWindowIndex(entry.candidate, windowSeconds);
    if (!byWindow.has(windowIndex)) byWindow.set(windowIndex, []);
    byWindow.get(windowIndex)?.push(entry);
  }

  for (const bucket of byWindow.values()) {
    bucket.sort(compareScoredCandidatePriority);
  }

  const selected: ClaimCandidate[] = [];
  const selectedPerWindow = new Map<number, number>();
  const selectedSet = new Set<ClaimCandidate>();
  const sortedWindowIndexes = Array.from(byWindow.keys()).sort((a, b) => a - b);
  const targetWindowCount = Math.min(sortedWindowIndexes.length, minWindows, maxClaims);

  for (const windowIndex of sortedWindowIndexes) {
    if (selected.length >= targetWindowCount) break;
    const bucket = byWindow.get(windowIndex);
    const best = bucket?.[0];
    if (!best) continue;
    selected.push(best.candidate);
    selectedSet.add(best.candidate);
    selectedPerWindow.set(windowIndex, 1);
  }

  for (const entry of scoredCandidates) {
    if (selected.length >= maxClaims) break;
    if (selectedSet.has(entry.candidate)) continue;
    const windowIndex = resolveWindowIndex(entry.candidate, windowSeconds);
    const usedCount = selectedPerWindow.get(windowIndex) ?? 0;
    if (usedCount >= maxPerWindow) continue;
    selected.push(entry.candidate);
    selectedSet.add(entry.candidate);
    selectedPerWindow.set(windowIndex, usedCount + 1);
  }

  return selected.sort(compareCandidateOutputOrder);
}

export function runEditorPassV1(
  candidates: ClaimCandidate[],
  options: EditorialPassV1Options
): ClaimCandidate[] {
  return runEditorPassV1WithDiagnostics(candidates, options).selected;
}

export function runEditorPassV1WithDiagnostics(
  candidates: ClaimCandidate[],
  options: EditorialPassV1Options
): { selected: ClaimCandidate[]; diagnostics: EditorialDiagnostics } {
  const droppedCounts = defaultDroppedCounts();
  const filtered: ClaimCandidate[] = [];

  for (const candidate of candidates) {
    const text = normalizeText(candidate.text);
    if (text.length === 0) {
      droppedCounts.empty += 1;
      continue;
    }
    if (isLowValue(text)) {
      droppedCounts.boilerplate += 1;
      continue;
    }
    if (isTooShortV1(text)) {
      droppedCounts.fragment += 1;
      continue;
    }
    filtered.push(candidate);
  }

  const deduped = dedupeCandidates(
    filtered,
    (left, right) => {
      const scoreDiff = scoreCandidateV1(right) - scoreCandidateV1(left);
      if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
      const startDiff = candidateStart(left) - candidateStart(right);
      if (startDiff !== 0) return startDiff;
      const textDiff = left.text.localeCompare(right.text);
      if (textDiff !== 0) return textDiff;
      return stableExcerptKey(left).localeCompare(stableExcerptKey(right));
    },
    0.8
  );
  droppedCounts.duplicate += deduped.duplicateCount;

  const selected = selectV1DiverseCandidates(deduped.deduped, options.maxClaims, options.chunkCount);
  droppedCounts.coverage += deduped.deduped.length - selected.length;

  return {
    selected,
    diagnostics: {
      editorVersion: 'v1',
      totalCandidates: candidates.length,
      selectedCount: selected.length,
      droppedCounts,
      windowCoverage: buildWindowCoverage(
        selected,
        candidate => (typeof candidate.chunkIndex === 'number' ? candidate.chunkIndex : -1)
      ),
      echoTaggedCount: 0, // v1 does not support echo detection
      echoAnalyzedCount: 0,
    },
  };
}

export function runEditorPassV2(
  candidates: ClaimCandidate[],
  options: EditorialPassV2Options
): ClaimCandidate[] {
  return runEditorPassV2WithDiagnostics(candidates, options).selected;
}

export function runEditorPassV2WithDiagnostics(
  candidates: ClaimCandidate[],
  options: EditorialPassV2Options
): { selected: ClaimCandidate[]; diagnostics: EditorialDiagnostics } {
  const droppedCounts = defaultDroppedCounts();
  const filtered: ClaimCandidate[] = [];
  const minWords = Math.max(1, options.minWords ?? DEFAULT_V2_MIN_WORDS);
  const minChars = Math.max(1, options.minChars ?? DEFAULT_V2_MIN_CHARS);
  const boilerplatePenalty = clamp(
    options.boilerplatePenalty ?? DEFAULT_V2_BOILERPLATE_PENALTY,
    0,
    1
  );
  const fragmentPenalty = clamp(options.fragmentPenalty ?? DEFAULT_V2_FRAGMENT_PENALTY, 0, 1);
  const dropThreshold = clamp(options.dropThreshold ?? DEFAULT_V2_DROP_THRESHOLD, 0, 1);
  const dedupeOverlapThreshold = clamp(
    options.dedupeOverlapThreshold ?? DEFAULT_V2_DEDUPE_OVERLAP,
    0,
    1
  );
  const semanticSimilarityThreshold = clamp(
    options.semanticSimilarityThreshold ?? DEFAULT_V2_SEMANTIC_SIMILARITY_THRESHOLD,
    0,
    1
  );

  // Echo detection configuration
  const echoMode = options.echoDetection?.mode ?? 'tag';
  const echoThreshold = clamp(
    options.echoDetection?.overlapThreshold ?? DEFAULT_V2_ECHO_OVERLAP_THRESHOLD,
    0,
    1
  );

  const scoreOptions = {
    excerptTextLengthById: options.excerptTextLengthById,
    boilerplatePenalty,
    fragmentPenalty,
    minWords,
    minChars,
  };

  // Score cache to avoid redundant computation in hot paths
  // Use stable string keys instead of object references to avoid issues with object mutation
  // Cache key includes all fields that scoreCandidateV2 reads: startSeconds, text,
  // excerptIds, confidence, domain, classification, evidenceType
  const scoreCache = new Map<string, number>();
  const getCacheKey = (candidate: ClaimCandidate): string => {
    return `${candidate.startSeconds}:${candidate.text}:${candidate.excerptIds.join(',')}:${candidate.confidence ?? ''}:${candidate.domain ?? ''}:${candidate.classification ?? ''}:${candidate.evidenceType ?? ''}`;
  };
  const getScore = (candidate: ClaimCandidate): number => {
    const key = getCacheKey(candidate);
    const cached = scoreCache.get(key);
    if (cached !== undefined) return cached;
    const score = scoreCandidateV2(candidate, scoreOptions);
    scoreCache.set(key, score);
    return score;
  };

  const comparePriority = (left: ClaimCandidate, right: ClaimCandidate): number => {
    const scoreDiff = getScore(right) - getScore(left);
    if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
    const startDiff = candidateStart(left) - candidateStart(right);
    if (startDiff !== 0) return startDiff;
    const textDiff = left.text.localeCompare(right.text);
    if (textDiff !== 0) return textDiff;
    return stableExcerptKey(left).localeCompare(stableExcerptKey(right));
  };

  // Track echo statistics
  let echoTaggedCount = 0;
  let echoAnalyzedCount = 0;

  // Phase 1: Apply quality filters and calculate echo overlap ratios
  // Only create new array if echo detection is enabled and excerpt texts are available
  const excerptTexts = options.excerptTextsById;
  const candidatesWithEcho = (echoMode !== 'off' && excerptTexts)
    ? candidates.map(candidate => {
        const overlapRatio = calculateEchoOverlapRatio(candidate, excerptTexts);
        if (overlapRatio !== undefined) {
          echoAnalyzedCount++;
          if (overlapRatio >= echoThreshold) {
            echoTaggedCount++;
          }
          return { ...candidate, echoOverlapRatio: overlapRatio };
        }
        return candidate;
      })
    : candidates; // Use original array when echo detection is disabled

  for (const candidate of candidatesWithEcho) {
    const text = normalizeText(candidate.text);
    if (text.length === 0) {
      droppedCounts.empty += 1;
      continue;
    }

    const score = getScore(candidate);

    if (isLowValue(text) && score <= dropThreshold) {
      droppedCounts.boilerplate += 1;
      continue;
    }
    if (isTooShortV2(text, minWords, minChars) && score <= dropThreshold) {
      droppedCounts.fragment += 1;
      continue;
    }
    filtered.push(candidate);
  }

  // First pass: exact match and excerpt overlap deduplication
  const deduped = dedupeCandidates(filtered, comparePriority, dedupeOverlapThreshold);
  droppedCounts.duplicate += deduped.duplicateCount;

  // Second pass: semantic similarity deduplication for paraphrases
  const semanticDeduped = semanticDedupe(
    deduped.deduped,
    comparePriority,
    semanticSimilarityThreshold
  );
  droppedCounts.duplicate += semanticDeduped.duplicateCount;

  const windowSeconds = Math.max(
    60,
    Math.floor((options.windowMinutes ?? DEFAULT_WINDOW_MINUTES) * 60)
  );
  const scoredCandidates = semanticDeduped.deduped
    .map(candidate => ({
      candidate,
      score: getScore(candidate),
      windowIndex: resolveWindowIndex(candidate, windowSeconds),
    }))
    .sort(compareScoredCandidatePriority);

  const selected = selectV2DiverseCandidates(scoredCandidates, options);
  droppedCounts.coverage += semanticDeduped.deduped.length - selected.length;

  return {
    selected,
    diagnostics: {
      editorVersion: 'v2',
      totalCandidates: candidates.length,
      selectedCount: selected.length,
      droppedCounts,
      windowCoverage: buildWindowCoverage(
        selected,
        candidate => resolveWindowIndex(candidate, windowSeconds)
      ),
      echoTaggedCount,
      echoAnalyzedCount,
    },
  };
}
