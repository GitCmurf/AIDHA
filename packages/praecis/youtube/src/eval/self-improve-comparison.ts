import type { NarrowDerivedJudgeScores, NarrowJudgeFindings } from "./narrow-judge.js";
import { deriveNarrowJudgeScores } from "./narrow-judge.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { ClaimCandidate } from "../extract/types.js";

export interface PassComparisonResult {
  pass1: NarrowDerivedJudgeScores;
  selfImproved: NarrowDerivedJudgeScores;
  deltaGoldCoverage: number;
  deltaOverallScore: number;
  improved: boolean;
}

/**
 * Compare two sets of judge findings (e.g., Pass 1 vs Self-Improved)
 * against the same gold baseline.
 */
export function comparePasses(
  pass1Findings: NarrowJudgeFindings,
  pass1Claims: ClaimCandidate[],
  selfImprovedFindings: NarrowJudgeFindings,
  selfImprovedClaims: ClaimCandidate[],
  flattenedGold: FlattenedGoldenClaimNode[]
): PassComparisonResult {
  const pass1Scores = deriveNarrowJudgeScores(pass1Findings, flattenedGold, pass1Claims);
  const selfImprovedScores = deriveNarrowJudgeScores(selfImprovedFindings, flattenedGold, selfImprovedClaims);

  const deltaGoldCoverage = selfImprovedScores.goldCoverage - pass1Scores.goldCoverage;
  const deltaOverallScore = selfImprovedScores.overallScore - pass1Scores.overallScore;

  return {
    pass1: pass1Scores,
    selfImproved: selfImprovedScores,
    deltaGoldCoverage,
    deltaOverallScore,
    improved: deltaOverallScore > 0 || deltaGoldCoverage > 0,
  };
}
