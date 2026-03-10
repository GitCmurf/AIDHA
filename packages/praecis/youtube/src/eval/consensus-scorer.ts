import type { ClaimSetScore } from "./scoring-rubric.js";
import { SCORE_DIMENSIONS } from "./scoring-rubric.js";

export interface ConsensusResult {
  mean: ClaimSetScore;
  variance: Partial<keyof ClaimSetScore, number>;
  isHighVariance: boolean;
}

export const computeConsensus = (scores: ClaimSetScore[]): ConsensusResult | null => {
  if (scores.length === 0) return null;

  const mean: any = {
    reasoning: "Consensus of multiple judges",
    missingClaims: [],
    hallucinations: [],
    redundancies: [],
    gapAreas: [],
  };

  const variance: Partial<Record<ScoreDimension, number>> = {};
  let isHighVariance = false;
  const VARIANCE_THRESHOLD = 2.0; // Variance > 2.0 as per Task 004

  for (const dim of SCORE_DIMENSIONS) {
    const values = scores.map((s) => s[dim]);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    mean[dim] = Number(avg.toFixed(2));

    if (values.length > 1) {
      const v = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;
      variance[dim] = Number(v.toFixed(2));
      if (v > VARIANCE_THRESHOLD) {
        isHighVariance = true;
      }
    } else {
      variance[dim] = 0;
    }
  }

  return {
    mean: mean as ClaimSetScore,
    variance,
    isHighVariance,
  };
};
