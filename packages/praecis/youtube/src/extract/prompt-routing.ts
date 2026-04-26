import type { ClaimCandidate } from "./types.js";

export type ExtractionPromptPackId =
  | "generic-hierarchy"
  | "enumeration-framework"
  | "clinical-risk-management"
  | "business-framework"
  | "enumeration-framework-v2"
  | "clinical-risk-management-v2";

export type PromptRouteSource = "metadata" | "transcript-profile" | "fallback-default";
export type PromptRetryReason =
  | "missing-root-claim"
  | "missing-enumeration-framework"
  | "low-domain-term-recall"
  | "too-few-claims";

export interface TranscriptProfile {
  listCueCount: number;
  clinicalCueCount: number;
  businessCueCount: number;
  glossaryTerms: string[];
  signals: string[];
}

export interface PromptRoutingDecision {
  promptPackId: ExtractionPromptPackId;
  routeSource: PromptRouteSource;
  routeConfidence: number;
  routeSignals: string[];
}

export interface PromptRetryDecision {
  retry: boolean;
  retryReason?: PromptRetryReason;
  retryPromptPackId?: ExtractionPromptPackId;
}

const STRUCTURAL_CUES = [
  "five", "four", "types", "steps", "layouts", "categories", "pillars", "guides",
];
const DOMAIN_CUES = [
  "principles", "framework",
];

const ENUMERATION_PATTERN = /\b(?:one|two|three|four|five)\s+(?:principles|types|steps|layouts|categories|pillars)\b/;
const CLINICAL_CUES = [
  "mg/dl", "nmol/l", "ldl", "apob", "lipoprotein", "cholesterol", "risk factor", "therapy",
  "atherosclerotic", "cardiovascular", "aspirin", "niacin", "siRNA", "screening", "genetic",
];
const BUSINESS_CUES = [
  "slide", "slides", "deck", "presentation", "consulting", "mckinsey", "bain", "bcg",
  "framework slide", "chart slide", "subtitle slide", "appendix", "client",
];

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const precompiledCueRegexes = new Map<string, RegExp>();
function getCueRegex(cue: string): RegExp {
  const cached = precompiledCueRegexes.get(cue);
  if (cached) return cached;
  const regex = new RegExp(`\\b${escapeRegex(cue)}\\b`, "i");
  precompiledCueRegexes.set(cue, regex);
  return regex;
}

function countCueMatches(text: string, cues: string[]): number {
  return cues.reduce((count, cue) => {
    return count + (getCueRegex(cue).test(text) ? 1 : 0);
  }, 0);
}

function uniqueTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

/**
 * Analyzes transcript text to identify structural and domain cues.
 * Returns a profile containing cue counts and specific glossary signals.
 *
 * @param text - The transcript text to profile
 * @returns A TranscriptProfile containing identified cues and signals
 */
export function buildTranscriptProfile(text: string): TranscriptProfile {
  const normalized = text.toLowerCase();
  const signals: string[] = [];
  const glossaryTerms: string[] = [];

  let listCueCount = 0;
  for (const cue of STRUCTURAL_CUES) {
    if (getCueRegex(cue).test(normalized)) {
      listCueCount += 1;
      signals.push(`list:${cue}`);
    }
  }
  for (const cue of DOMAIN_CUES) {
    if (getCueRegex(cue).test(normalized)) {
      signals.push(`domain:${cue}`);
      glossaryTerms.push(cue);
    }
  }
  // Also count regex-based enumeration patterns as strong list cues
  if (ENUMERATION_PATTERN.test(normalized)) {
    listCueCount += 1;
    signals.push("list:enumeration-pattern");
  }

  let clinicalCueCount = 0;
  for (const cue of CLINICAL_CUES) {
    if (getCueRegex(cue).test(normalized)) {
      clinicalCueCount += 1;
      signals.push(`clinical:${cue}`);
      glossaryTerms.push(cue);
    }
  }

  let businessCueCount = 0;
  for (const cue of BUSINESS_CUES) {
    if (getCueRegex(cue).test(normalized)) {
      businessCueCount += 1;
      signals.push(`business:${cue}`);
      glossaryTerms.push(cue);
    }
  }

  return {
    listCueCount,
    clinicalCueCount,
    businessCueCount,
    glossaryTerms: uniqueTerms(glossaryTerms),
    signals,
  };
}

function routeFromTopicDomain(topicDomain: string | undefined): ExtractionPromptPackId | undefined {
  const normalized = topicDomain?.toLowerCase() ?? "";
  if (!normalized) return undefined;
  if (/(consult|business|finance|strategy|presentation|deck|slide)/.test(normalized)) {
    return "business-framework";
  }
  if (/(clinical|medical|cardio|lipid|health|medicine|biology)/.test(normalized)) {
    return "clinical-risk-management";
  }
  return undefined;
}

function routeFromProfile(profile: TranscriptProfile): ExtractionPromptPackId {
  if (profile.businessCueCount >= 2) return "business-framework";
  if (profile.clinicalCueCount >= 2) return "clinical-risk-management";
  if (profile.listCueCount >= 2) return "enumeration-framework";
  return "generic-hierarchy";
}

function routeConfidenceForPack(packId: ExtractionPromptPackId, profile: TranscriptProfile): number {
  switch (packId) {
    case "business-framework":
      return Math.min(1, 0.35 + (profile.businessCueCount * 0.15));
    case "clinical-risk-management":
      return Math.min(1, 0.35 + (profile.clinicalCueCount * 0.12));
    case "enumeration-framework":
      return Math.min(1, 0.35 + (profile.listCueCount * 0.15));
    default:
      return 0.4;
  }
}

/**
 * Decides the optimal prompt pack based on video metadata and transcript content.
 * Falls back to generic-hierarchy if no specific pack is strongly indicated.
 *
 * @param input - Object containing topicDomain, title, and transcriptText
 * @returns An object with the routing decision and the transcript profile used
 */
export function decidePromptPack(input: {
  topicDomain?: string;
  title?: string;
  transcriptText: string;
}): { decision: PromptRoutingDecision; profile: TranscriptProfile } {
  const profile = buildTranscriptProfile(`${input.title ?? ""}\n${input.transcriptText}`);
  const metadataPack = routeFromTopicDomain(input.topicDomain);
  const inferredPack = routeFromProfile(profile);

  if (metadataPack) {
    const metadataConfidence = 0.85;
    const inferredConfidence = routeConfidenceForPack(inferredPack, profile);
    // Only override explicit metadata when transcript inference is at least as confident
    if (inferredPack !== metadataPack && inferredConfidence >= metadataConfidence) {
      return {
        profile,
        decision: {
          promptPackId: inferredPack,
          routeSource: "transcript-profile",
          routeConfidence: inferredConfidence,
          routeSignals: profile.signals.slice(0, 8),
        },
      };
    }
    return {
      profile,
      decision: {
        promptPackId: metadataPack,
        routeSource: "metadata",
        routeConfidence: metadataConfidence,
        routeSignals: profile.signals.slice(0, 8),
      },
    };
  }

  const packId = inferredPack;
  return {
    profile,
    decision: {
      promptPackId: packId,
      routeSource: packId === "generic-hierarchy" ? "fallback-default" : "transcript-profile",
      routeConfidence: routeConfidenceForPack(packId, profile),
      routeSignals: profile.signals.slice(0, 8),
    },
  };
}

function looksRootLike(text: string): boolean {
  const normalized = text.toLowerCase();
  return /(there are|there is|consists of|includes|account for|guide management|management follows|uses .* core|standardized set|core slide layouts|strong independent risk factor)/.test(normalized)
    || /(?:four|five|three|two|\d+)\s+(?:principles|types|steps|layouts|categories)/.test(normalized);
}

function looksEnumerationLike(text: string): boolean {
  const normalized = text.toLowerCase();
  return /(?:four|five|three|two|\d+)\s+(?:principles|types|steps|layouts|categories)/.test(normalized);
}

function computeDomainTermRecall(claims: ClaimCandidate[], glossaryTerms: string[]): number {
  if (glossaryTerms.length === 0) return 1;
  if (claims.length === 0) return 0;
  const normalizedClaims = claims.map((claim) => claim.text.toLowerCase()).join(" ");
  const matched = glossaryTerms.filter((term) => normalizedClaims.includes(term.toLowerCase())).length;
  return matched / glossaryTerms.length;
}

/**
 * Evaluates extraction results to determine if a retry with a different prompt pack is needed.
 * Triggered by missing structural elements (roots, enumerations) or low domain term recall.
 *
 * @param input - Object containing current claims, current prompt pack, and transcript profile
 * @returns A decision object indicating if a retry is warranted and the recommended pack
 */
export function determineRetryDecision(input: {
  claims: ClaimCandidate[];
  promptPackId: ExtractionPromptPackId;
  profile: TranscriptProfile;
}): PromptRetryDecision {
  const { claims, promptPackId, profile } = input;
  const hasRootClaim = claims.some((claim) => looksRootLike(claim.text));
  const hasEnumerationClaim = claims.some((claim) => looksEnumerationLike(claim.text));
  const domainTermRecall = computeDomainTermRecall(claims, profile.glossaryTerms);

  const isV2Pack = promptPackId.endsWith("-v2");

  if (claims.length === 0) {
    // Allow v1 -> v2 escalation; only block retry when already on the v2 target
    if (profile.clinicalCueCount >= 2 && promptPackId !== "clinical-risk-management-v2") {
      return { retry: true, retryReason: "too-few-claims", retryPromptPackId: !isV2Pack ? "clinical-risk-management-v2" : "clinical-risk-management" };
    }
    if (profile.businessCueCount >= 2 && promptPackId !== "business-framework") {
      return { retry: true, retryReason: "too-few-claims", retryPromptPackId: "business-framework" };
    }
    if (profile.listCueCount >= 2 && promptPackId !== "enumeration-framework-v2") {
      return { retry: true, retryReason: "too-few-claims", retryPromptPackId: !isV2Pack ? "enumeration-framework-v2" : "enumeration-framework" };
    }
  }

  // Allow v1 -> v2 escalation for missing-root-claim; only block when already on v2 target
  if (!hasRootClaim && profile.listCueCount >= 2 && promptPackId !== "enumeration-framework-v2") {
    return { retry: true, retryReason: "missing-root-claim", retryPromptPackId: !isV2Pack ? "enumeration-framework-v2" : "enumeration-framework" };
  }
  if (!hasEnumerationClaim && profile.listCueCount >= 2 && promptPackId === "business-framework") {
    return { retry: true, retryReason: "missing-enumeration-framework", retryPromptPackId: "enumeration-framework" };
  }
  // Allow v1 -> v2 escalation for low-domain-term-recall; only block when already on v2 target
  if (domainTermRecall < 0.35 && profile.clinicalCueCount >= 2 && promptPackId !== "clinical-risk-management-v2") {
    return { retry: true, retryReason: "low-domain-term-recall", retryPromptPackId: !isV2Pack ? "clinical-risk-management-v2" : "clinical-risk-management" };
  }
  if (domainTermRecall < 0.35 && profile.businessCueCount >= 2 && promptPackId !== "business-framework") {
    return { retry: true, retryReason: "low-domain-term-recall", retryPromptPackId: "business-framework" };
  }

  return { retry: false };
}

/**
 * Calculates a structural completeness score (0-1) for a set of claims.
 * Weighting: Root coverage (35%), Enumeration coverage (20%), Domain recall (25%), Count (20%).
 *
 * @param claims - The extracted claims to score
 * @param profile - The transcript profile to compare against
 * @returns A completeness score between 0 and 1
 */
export function scoreStructuralCompleteness(claims: ClaimCandidate[], profile: TranscriptProfile): number {
  const hasRootClaim = claims.some((claim) => looksRootLike(claim.text)) ? 1 : 0;
  const hasEnumerationClaim = claims.some((claim) => looksEnumerationLike(claim.text)) ? 1 : 0;
  const domainTermRecall = computeDomainTermRecall(claims, profile.glossaryTerms);
  const claimCountScore = Math.min(1, claims.length / 8);
  return (hasRootClaim * 0.35) + (hasEnumerationClaim * 0.2) + (domainTermRecall * 0.25) + (claimCountScore * 0.2);
}
