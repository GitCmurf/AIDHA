import type { ClaimCandidate } from './types.js';
import type { EditorialDiagnostics, EditorialDropReason } from './editorial-ranking.js';
import { normalizeText } from './utils.js';
import { BOILERPLATE_PATTERNS, CONJUNCTION_ENDINGS } from './constants.js';

const DEFAULT_FRAGMENT_MIN_WORDS = 8;
const DEFAULT_FRAGMENT_MIN_CHARS = 50;
const DEFAULT_WINDOW_MINUTES = 5;

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
    if (lastWord && (CONJUNCTION_ENDINGS as readonly string[]).includes(lastWord)) return true;
    return text.includes('...');
  }).length;
}

export function countBoilerplate(
  candidates: ClaimCandidate[],
  patterns: RegExp[] = BOILERPLATE_PATTERNS
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
