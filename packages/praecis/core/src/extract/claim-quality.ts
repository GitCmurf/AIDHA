import type { ClaimCandidate } from './types.js';
import { calculateTokenOverlap, tokenize } from './verification.js';
import { clamp, normalizeText } from './utils.js';

export const CLAIM_QUALITY_STATUSES = ['pending', 'reviewable', 'accepted', 'rejected'] as const;
export type ClaimQualityStatus = typeof CLAIM_QUALITY_STATUSES[number];

export const CLAIM_QUALITY_REASONS = [
  'missing_support',
  'unsupported_inference',
  'domain_drift',
  'reported_speech',
  'category_soup',
  'weak_rationale',
  'poor_prose',
] as const;
export type ClaimQualityReason = typeof CLAIM_QUALITY_REASONS[number];

export interface ClaimQualityAssessment {
  readonly qualityStatus: ClaimQualityStatus;
  readonly trusted: boolean;
  readonly qualityScore: number;
  readonly qualityReasons: readonly ClaimQualityReason[];
  readonly supportCoverage: number;
}

export interface ClaimQualityInput {
  readonly candidate: ClaimCandidate;
  readonly evidenceTexts: readonly string[];
  readonly resourceLabel?: string;
}

const BOX_TICKING_SUPPORT_PATTERN =
  /^(?:direct(?:\s+(?:report|example|quote|support))?|source\s+support|transcript\s+support|evidence\s+supports\s+the\s+claim|the\s+(?:speaker|host|presenter|demonstrator|transcript)\s+(?:describes|states|says|explains|mentions|reports|shows)\.?$)$/i;

const REPORTED_SPEECH_PATTERN =
  /^\s*(?:the\s+)?(?:speaker|host|presenter|demonstrator|narrator|video|transcript)\s+(?:claims?|claimed|says?|said|states?|stated|suggests?|suggested|recommends?|recommended|argues?|argued|reports?|reported|mentions?|mentioned|explains?|explained|asserts?|asserted|describes?|described|cites?|cited)\b/i;

const KNOWLEDGE_SYSTEM_PATTERN =
  /\b(?:obsidian|claude code|markdown|wiki|backlinks?|second brain|rag|embedding|vector database|semantic search|knowledge system|vault)\b/i;

const ACADEMIC_DRIFT_PATTERN =
  /\b(?:neuro(?:science|informatics)?|cognitive neuroscience|working memory|memory consolidation|neural|metabolic|metabolism|physiology|protein kinetics|lipidology|endocrinology|bioenergetics|hormonal|sleep science|exercise physiology)\b/i;

const INFERENCE_VERB_PATTERN =
  /\b(?:decreases?|reduces?|improves?|enables?|implies?|suggests?|corresponds?|offloads?|optimizes?|causes?|leads to|results in)\b/i;

const RECOMMENDATION_PATTERN =
  /\b(?:recommend(?:s|ed|ing)?|should|prefer|avoid|more appropriate|better than|rather than)\b/i;

const REASON_BEARING_PATTERN =
  /\b(?:because|since|due to|so that|therefore|as a result|at scale|compared with|contrasts? with|whereas|instead of|rather than|bottleneck|cost|token usage|current models|for now|limitation|trade-?off)\b/i;

// Below this coverage, a claim needs most of its salient terms present in evidence.
const LOW_SUPPORT_COVERAGE_THRESHOLD = 0.12;
// Above this unsupported-token ratio, low-coverage claims are likely inferred.
const MAX_UNSUPPORTED_RATIO_LOW_SUPPORT = 0.45;
// Inference-verb claims get a second check even with slightly more coverage.
const MODERATE_SUPPORT_COVERAGE_THRESHOLD = 0.2;
// Unsupported-token tolerance for claims that assert a mechanism or effect.
const MAX_UNSUPPORTED_RATIO_INFERENCE = 0.5;

function usefulText(value: string | undefined): string | undefined {
  const normalized = value ? normalizeText(value) : '';
  if (!normalized || BOX_TICKING_SUPPORT_PATTERN.test(normalized)) return undefined;
  const substantiveTokens = tokenize(normalized).filter(token => token.length >= 4);
  if (substantiveTokens.length < 4) return undefined;
  return normalized;
}

function hasReasonBearingText(...values: Array<string | undefined>): boolean {
  return values.some(value => {
    const normalized = usefulText(value);
    return normalized ? REASON_BEARING_PATTERN.test(normalized) : false;
  });
}

function hasCategorySoupList(text: string): boolean {
  const listMatch = /\bsuch as\b(.+)$/i.exec(text);
  if (!listMatch?.[1]) return false;
  const listItems = listMatch[1].split(/\s*,\s*|\s+and\s+/).map(item => item.trim()).filter(Boolean);
  if (listItems.length < 5) return false;
  const namedItems = listItems.filter(item => /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/.test(item));
  return namedItems.length >= 5 && /\b(?:uses?|navigate|navigation|backlinks?|tags?|categories|concepts|tools?)\b/i.test(text);
}

function hasPoorProse(text: string): boolean {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return text.length < 35
    || wordCount < 6
    || /(?:\.\.\.|[,;:]$|\b(?:and|or|but|because|which|that)$)/i.test(text)
    || /\s{2,}/.test(text);
}

function unsupportedSalientTokenRatio(claimText: string, evidenceText: string): number {
  const evidenceTokens = new Set(tokenize(evidenceText));
  const salientClaimTokens = tokenize(claimText)
    .filter(token => token.length >= 7)
    .filter(token => !/^(?:speaker|source|transcript|because|through|between|without)$/.test(token));
  if (salientClaimTokens.length === 0) return 0;
  const unsupported = salientClaimTokens.filter(token => !evidenceTokens.has(token));
  return unsupported.length / salientClaimTokens.length;
}

function hasDomainDrift(candidate: ClaimCandidate, evidenceText: string): boolean {
  const domain = candidate.domain ?? '';
  const text = candidate.text;
  const sourceLooksLikeKnowledgeSystem = KNOWLEDGE_SYSTEM_PATTERN.test(evidenceText);
  if (!sourceLooksLikeKnowledgeSystem) return false;
  if (!ACADEMIC_DRIFT_PATTERN.test(`${domain} ${text}`)) return false;
  return !ACADEMIC_DRIFT_PATTERN.test(evidenceText);
}

function hasUnsupportedInference(candidate: ClaimCandidate, evidenceText: string, supportCoverage: number): boolean {
  const text = candidate.text;
  if (!evidenceText) return true;
  if (hasDomainDrift(candidate, evidenceText)) return true;
  if (ACADEMIC_DRIFT_PATTERN.test(text) && !ACADEMIC_DRIFT_PATTERN.test(evidenceText)) return true;

  const unsupportedRatio = unsupportedSalientTokenRatio(text, evidenceText);
  if (
    supportCoverage < LOW_SUPPORT_COVERAGE_THRESHOLD
    && unsupportedRatio > MAX_UNSUPPORTED_RATIO_LOW_SUPPORT
    && INFERENCE_VERB_PATTERN.test(text)
  ) return true;
  if (
    supportCoverage < MODERATE_SUPPORT_COVERAGE_THRESHOLD
    && unsupportedRatio > MAX_UNSUPPORTED_RATIO_INFERENCE
    && INFERENCE_VERB_PATTERN.test(text)
  ) return true;
  return false;
}

function requiresRationale(candidate: ClaimCandidate): boolean {
  const text = candidate.text;
  return RECOMMENDATION_PATTERN.test(text)
    || candidate.type === 'warning'
    || candidate.classification === 'warning'
    || /\b(?:trade-?off|limitation|at scale|cost|token usage|rather than|compared with)\b/i.test(text);
}

function addReason(reasons: Set<ClaimQualityReason>, reason: ClaimQualityReason): void {
  reasons.add(reason);
}

export function assessClaimQuality(input: ClaimQualityInput): ClaimQualityAssessment {
  const { candidate } = input;
  const text = normalizeText(candidate.text);
  const evidenceText = normalizeText(input.evidenceTexts.join(' '));
  const reasons = new Set<ClaimQualityReason>();
  const supportCoverage = evidenceText ? calculateTokenOverlap(text, evidenceText) : 0;

  if (hasPoorProse(text)) addReason(reasons, 'poor_prose');
  if (REPORTED_SPEECH_PATTERN.test(text)) addReason(reasons, 'reported_speech');
  if (hasCategorySoupList(text)) addReason(reasons, 'category_soup');
  if (!usefulText(candidate.supportSummary)) addReason(reasons, 'missing_support');
  if (requiresRationale(candidate) && !usefulText(candidate.rationale) && !hasReasonBearingText(candidate.supportSummary)) {
    addReason(reasons, 'weak_rationale');
  }
  if (hasDomainDrift(candidate, evidenceText)) addReason(reasons, 'domain_drift');
  if (hasUnsupportedInference(candidate, evidenceText, supportCoverage)) addReason(reasons, 'unsupported_inference');

  const hardReasons: readonly ClaimQualityReason[] = [
    'missing_support',
    'unsupported_inference',
    'domain_drift',
    'reported_speech',
    'category_soup',
    'poor_prose',
    'weak_rationale',
  ];
  const rejected = hardReasons.some(reason => reasons.has(reason));
  const reasonCount = reasons.size;
  const qualityScore = clamp(supportCoverage + (usefulText(candidate.supportSummary) ? 0.35 : 0) - (reasonCount * 0.12), 0, 1);

  return {
    qualityStatus: rejected ? 'rejected' : 'reviewable',
    trusted: false,
    qualityScore,
    qualityReasons: [...reasons],
    supportCoverage,
  };
}

export function applyClaimQualityAssessment(
  candidate: ClaimCandidate,
  assessment: ClaimQualityAssessment
): ClaimCandidate {
  return {
    ...candidate,
    qualityStatus: assessment.qualityStatus,
    trusted: assessment.trusted,
    qualityScore: assessment.qualityScore,
    qualityReasons: [...assessment.qualityReasons],
    supportCoverage: assessment.supportCoverage,
  };
}
