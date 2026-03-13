import type { ClaimSetScore, ScoreDimension } from "./scoring-rubric.js";
import { SCORE_DIMENSIONS } from "./scoring-rubric.js";
import { deduplicateByKey } from "../extract/utils.js";

const DEFAULT_CONSENSUS_REASONING = "Consensus of multiple judges";

export interface ConsensusResult {
  mean: ClaimSetScore;
  variance: Partial<Record<ScoreDimension, number>>;
  isHighVariance: boolean;
}

export const computeConsensus = (scores: ClaimSetScore[]): ConsensusResult | null => {
  if (scores.length === 0) return null;

  const mean: ClaimSetScore = {
    completeness: 0,
    accuracy: 0,
    topicCoverage: 0,
    atomicity: 0,
    overallScore: 0,
    reasoning: scores.length === 1
      ? (scores[0]?.reasoning ?? DEFAULT_CONSENSUS_REASONING)
      : DEFAULT_CONSENSUS_REASONING,
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
    // Using population variance (dividing by n) since the judge scores are treated as the complete population
    // rather than a sample. This is appropriate for consensus scoring where all judges are known.
    const varianceValue = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;
      variance[dim] = Number(varianceValue.toFixed(2));
      if (varianceValue > VARIANCE_THRESHOLD) {
        isHighVariance = true;
      }
    } else {
      variance[dim] = 0;
    }
  }

  // Aggregate qualitative arrays (union, deduplicated by field value)
  const mergedMissing = deduplicateByKey(scores.flatMap(s => s.missingClaims), c => c.text);
  const mergedHallucinations = deduplicateByKey(scores.flatMap(s => s.hallucinations), c => c.text);
  const mergedRedundancies = deduplicateByKey(scores.flatMap(s => s.redundancies), c => c.text);
  const mergedGapAreas = deduplicateByKey(scores.flatMap(s => s.gapAreas), c => c.area);

  mean.missingClaims = mergedMissing;
  mean.hallucinations = mergedHallucinations;
  mean.redundancies = mergedRedundancies;
  mean.gapAreas = mergedGapAreas;

  return {
    mean,
    variance,
    isHighVariance,
  };
};
