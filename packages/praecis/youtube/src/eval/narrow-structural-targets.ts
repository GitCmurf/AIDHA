import type { ClaimCandidate } from "../extract/index.js";
import { normalizeKey } from "../extract/utils.js";

export interface TranscriptStructureProfile {
  tags: string[];
  cueMatches: string[];
  finiteSet?: {
    cardinalityTerms: string[];
    listNouns: string[];
    requiresAvoidRule: boolean;
  };
  definitionFirst?: { cueCount: number };
  framework?: { cueCount: number };
  process?: { cueCount: number };
  contrast?: { cueCount: number };
  recommendation?: { cueCount: number };
}

export interface StructuralTargetAssessment {
  score: number;
  hasRootCardinalityClaim: boolean;
  hasMemberListClaim: boolean;
  hasAvoidRuleClaim: boolean;
  passesShortlistGate: boolean;
}

const FINITE_SET_CUE =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b(?:\s+\w+){0,3}\s+\b(layouts?|principles?|steps?|types?|categories?|frameworks?|slides?|rules?|reasons?|options?|parts?|ways)\b/gi;
const AVOID_RULE_CUE = /\b(avoid|don't use|do not use|never use|should not use|shouldn't use)\b/i;
const DEFINITION_FIRST_CUE = /\b(is a|is an|refers to|defined as|consists of|composed of)\b/gi;
const FRAMEWORK_CUE = /\b(framework|frameworks|model|models|matrix|taxonomy|taxonomies|category|categories|principle|principles|pillar|pillars|dimension|dimensions)\b/gi;
const PROCESS_CUE = /\b(first|second|third|fourth|fifth|next|then|finally|step|steps|process|workflow|sequence)\b/gi;
const CONTRAST_CUE = /\b(versus|vs\.?|compared to|rather than|instead of|trade-off|tradeoff|on the other hand|whereas|while)\b/gi;
const RECOMMENDATION_CUE = /\b(should|must|need to|recommended|recommend|best used for|avoid|do not use|don't use)\b/gi;

function collectCueMatches(fullText: string, regex: RegExp, limit = 3): string[] {
  const matches: string[] = [];
  for (const match of fullText.matchAll(regex)) {
    if (!match[0]) continue;
    matches.push(match[0].toLowerCase());
    if (matches.length >= limit) break;
  }
  return matches;
}

export function profileTranscriptStructure(fullText: string): TranscriptStructureProfile {
  const cardinalityTerms = new Set<string>();
  const listNouns = new Set<string>();
  const cueMatches = new Set<string>();

  for (const match of fullText.matchAll(FINITE_SET_CUE)) {
    if (match[1]) cardinalityTerms.add(match[1].toLowerCase());
    if (match[2]) listNouns.add(match[2].toLowerCase());
    if (match[0]) cueMatches.add(match[0].toLowerCase());
  }

  const definitionMatches = collectCueMatches(fullText, DEFINITION_FIRST_CUE);
  const frameworkMatches = collectCueMatches(fullText, FRAMEWORK_CUE);
  const processMatches = collectCueMatches(fullText, PROCESS_CUE);
  const contrastMatches = collectCueMatches(fullText, CONTRAST_CUE);
  const recommendationMatches = collectCueMatches(fullText, RECOMMENDATION_CUE);

  for (const cue of [...definitionMatches, ...frameworkMatches, ...processMatches, ...contrastMatches, ...recommendationMatches]) {
    cueMatches.add(cue);
  }

  const profile: TranscriptStructureProfile = {
    tags: [],
    cueMatches: [...cueMatches].slice(0, 8),
  };

  if (cardinalityTerms.size > 0 && listNouns.size > 0) {
    profile.finiteSet = {
      cardinalityTerms: [...cardinalityTerms],
      listNouns: [...listNouns],
      requiresAvoidRule: AVOID_RULE_CUE.test(fullText),
    };
    profile.tags.push("finite-set");
  }
  if (definitionMatches.length > 0) {
    profile.definitionFirst = { cueCount: definitionMatches.length };
    profile.tags.push("definition-first");
  }
  if (frameworkMatches.length > 0) {
    profile.framework = { cueCount: frameworkMatches.length };
    profile.tags.push("framework");
  }
  if (processMatches.length > 0) {
    profile.process = { cueCount: processMatches.length };
    profile.tags.push("process");
  }
  if (contrastMatches.length > 0) {
    profile.contrast = { cueCount: contrastMatches.length };
    profile.tags.push("contrast");
  }
  if (recommendationMatches.length > 0) {
    profile.recommendation = { cueCount: recommendationMatches.length };
    profile.tags.push("recommendation");
  }

  return profile;
}

function hasEnumerationSurface(text: string): boolean {
  const commaCount = text.match(/,/g)?.length ?? 0;
  const conjunctionCount = text.match(/\b(and|or)\b/gi)?.length ?? 0;
  return commaCount >= 2 || (commaCount >= 1 && conjunctionCount >= 1) || /:\s*[^.]+,\s*[^.]+/i.test(text);
}

export function assessStructuralTargets(
  claims: ClaimCandidate[],
  transcriptProfile: TranscriptStructureProfile
): StructuralTargetAssessment {
  const finiteSet = transcriptProfile.finiteSet;
  if (!finiteSet || claims.length === 0) {
    return {
      score: 0,
      hasRootCardinalityClaim: false,
      hasMemberListClaim: false,
      hasAvoidRuleClaim: false,
      passesShortlistGate: false,
    };
  }

  const normalizedClaims = claims.map((claim) => normalizeKey(claim.text));
  const hasRootCardinalityClaim = normalizedClaims.some((text) =>
    finiteSet.cardinalityTerms.some((term) => text.includes(normalizeKey(term)))
      && finiteSet.listNouns.some((noun) => text.includes(normalizeKey(noun)))
  );
  const hasMemberListClaim = claims.some((claim) => hasEnumerationSurface(claim.text));
  const hasAvoidRuleClaim = normalizedClaims.some((text) => AVOID_RULE_CUE.test(text));

  const rootWeight = finiteSet.requiresAvoidRule ? 0.45 : 0.55;
  const memberWeight = finiteSet.requiresAvoidRule ? 0.35 : 0.45;
  const avoidWeight = finiteSet.requiresAvoidRule ? 0.20 : 0;

  return {
    score: Number(
      (
        (hasRootCardinalityClaim ? rootWeight : 0)
        + (hasMemberListClaim ? memberWeight : 0)
        + (hasAvoidRuleClaim ? avoidWeight : 0)
      ).toFixed(4)
    ),
    hasRootCardinalityClaim,
    hasMemberListClaim,
    hasAvoidRuleClaim,
    passesShortlistGate: hasRootCardinalityClaim,
  };
}
