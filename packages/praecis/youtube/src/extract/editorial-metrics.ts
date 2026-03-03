import type { ClaimCandidate } from './types.js';
import type { EditorialDiagnostics, EditorialDropReason } from './editorial-ranking.js';
import { normalizeText } from './utils.js';

const DEFAULT_FRAGMENT_MIN_WORDS = 8;
const DEFAULT_FRAGMENT_MIN_CHARS = 50;
const DEFAULT_WINDOW_MINUTES = 5;
const CONJUNCTION_ENDINGS = ['and', 'but', 'so', 'or', 'then'];

const DEFAULT_BOILERPLATE_PATTERNS = [
  /subscribe/i,
  /like and subscribe/i,
  /smash that (like|subscribe)/i,
  /sponsor/i,
  /patreon/i,
  /thanks for watching/i,
  /welcome back/i,
  /intro/i,
  /outro/i,
  // Wealthfront and financial sponsor CTAs
  /wealthfront/i,
  /APY on your cash/i,
  /annual percentage yield/i,
  /partner banks/i,
  /earn \d+% APY/i,
  /high-yield savings account/i,
  /automated investing/i,
  /tax-optimized/i,
  // Common ad-read patterns
  /special offer/i,
  /discount code/i,
  /promo code/i,
  /use code \w+/i,
  /limited time/i,
  /act now/i,
  /don't miss out/i,
  /click the link/i,
  /link in the (description|bio)/i,
  /affiliate link/i,
  /support the (channel|show|podcast)/i,
];

export interface FragmentRules {
  minWords?: number;
  minChars?: number;
}

export interface CoverageSummary {
  windowsRepresented: number;
  windowCounts: Array<{ windowIndex: number; count: number }>;
}

export function countFragments(
  candidates: ClaimCandidate[],
  rules: FragmentRules = {}
): number {
  const minWords = Math.max(1, rules.minWords ?? DEFAULT_FRAGMENT_MIN_WORDS);
  const minChars = Math.max(1, rules.minChars ?? DEFAULT_FRAGMENT_MIN_CHARS);

  return candidates.filter(candidate => {
    const text = normalizeText(candidate.text);
    if (text.length < minChars) return true;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < minWords) return true;
    const lastWord = words[words.length - 1]?.toLowerCase();
    if (lastWord && CONJUNCTION_ENDINGS.includes(lastWord)) return true;
    return text.includes('...');
  }).length;
}

export function countBoilerplate(
  candidates: ClaimCandidate[],
  patterns: RegExp[] = DEFAULT_BOILERPLATE_PATTERNS
): number {
  return candidates.filter(candidate => patterns.some(pattern => pattern.test(candidate.text))).length;
}

export function timelineCoverage(
  candidates: ClaimCandidate[],
  windowMinutes = DEFAULT_WINDOW_MINUTES
): CoverageSummary {
  const windowSeconds = Math.max(60, Math.floor(windowMinutes * 60));
  const byWindow = new Map<number, number>();
  for (const candidate of candidates) {
    const windowIndex = typeof candidate.startSeconds === 'number'
      ? Math.floor(Math.max(0, candidate.startSeconds) / windowSeconds)
      : (candidate.chunkIndex ?? -1);
    byWindow.set(windowIndex, (byWindow.get(windowIndex) ?? 0) + 1);
  }

  const windowCounts = Array.from(byWindow.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([windowIndex, count]) => ({ windowIndex, count }));

  return {
    windowsRepresented: windowCounts.length,
    windowCounts,
  };
}

export function dropCounts(
  diagnostics: EditorialDiagnostics
): Record<EditorialDropReason, number> {
  return {
    empty: diagnostics.droppedCounts.empty ?? 0,
    boilerplate: diagnostics.droppedCounts.boilerplate ?? 0,
    fragment: diagnostics.droppedCounts.fragment ?? 0,
    duplicate: diagnostics.droppedCounts.duplicate ?? 0,
    coverage: diagnostics.droppedCounts.coverage ?? 0,
  };
}
