import { SCORE_DIMENSIONS, type ScoreDimension } from "./scoring-rubric.js";
import type { MatrixCell } from "./matrix-runner.js";

export interface VariantDeltaInput {
  cells: MatrixCell[];
  baseVariant: string;
  compareVariant: string;
}

export interface VariantDeltaResult {
  baseVariant: string;
  compareVariant: string;
  matchedPairCount: number;
  /** compare − base, averaged over all matched (videoId, modelId, judgeModelId) pairs */
  meanDelta: Record<ScoreDimension, number>;
  /** compare − base for avg missingClaims array length; positive = compare has more missing claims */
  meanMissingClaimsDelta: number;
  /** compare − base for avg hallucinations array length; positive = compare has more hallucinations */
  meanHallucinationsDelta: number;
}

const zeroDimensionRecord = (): Record<ScoreDimension, number> =>
  Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, 0])) as Record<ScoreDimension, number>;

interface JudgeAlignedScore {
  judgeModelId: string;
  dimensions: Record<ScoreDimension, number>;
  missingClaims: number;
  hallucinations: number;
}

const LEGACY_JUDGE_MODEL_ID = "__legacy_judge__";

const aggregateScoresByJudge = (scores: NonNullable<MatrixCell["scores"]>): Map<string, JudgeAlignedScore> => {
  const buckets = new Map<string, { count: number; dimensions: Record<ScoreDimension, number>; missingClaims: number; hallucinations: number }>();

  for (const score of scores) {
    const judgeModelId = score.judgeMeta?.judgeModelId ?? LEGACY_JUDGE_MODEL_ID;

    const bucket = buckets.get(judgeModelId) ?? {
      count: 0,
      dimensions: zeroDimensionRecord(),
      missingClaims: 0,
      hallucinations: 0,
    };
    bucket.count += 1;
    for (const dim of SCORE_DIMENSIONS) {
      bucket.dimensions[dim] += score[dim];
    }
    bucket.missingClaims += score.missingClaims.length;
    bucket.hallucinations += score.hallucinations.length;
    buckets.set(judgeModelId, bucket);
  }

  const aggregated = new Map<string, JudgeAlignedScore>();
  for (const [judgeModelId, bucket] of buckets) {
    const dimensions = zeroDimensionRecord();
    for (const dim of SCORE_DIMENSIONS) {
      dimensions[dim] = bucket.dimensions[dim] / bucket.count;
    }
    aggregated.set(judgeModelId, {
      judgeModelId,
      dimensions,
      missingClaims: bucket.missingClaims / bucket.count,
      hallucinations: bucket.hallucinations / bucket.count,
    });
  }

  return aggregated;
};

export function computeVariantDelta(input: VariantDeltaInput): VariantDeltaResult {
  const { cells, baseVariant, compareVariant } = input;

  const baseCells = new Map<string, Map<string, JudgeAlignedScore>>();
  const compareCells = new Map<string, Map<string, JudgeAlignedScore>>();

  for (const cell of cells) {
    if (!cell.scores || cell.scores.length === 0) continue;
    const key = `${cell.videoId}|${cell.modelId}|${cell.promptConfigId ?? ""}|${cell.chunkMode ?? ""}`;
    const judgeScores = aggregateScoresByJudge(cell.scores);
    if (judgeScores.size === 0) continue;
    if (cell.extractorVariantId === baseVariant) baseCells.set(key, judgeScores);
    else if (cell.extractorVariantId === compareVariant) compareCells.set(key, judgeScores);
  }

  const deltaAcc = zeroDimensionRecord();
  let missingDeltaAcc = 0;
  let hallucinationDeltaAcc = 0;
  let n = 0;

  for (const [key, base] of baseCells) {
    const compare = compareCells.get(key);
    if (!compare) continue;
    for (const [judgeModelId, baseScore] of base) {
      const compareScore = compare.get(judgeModelId);
      if (!compareScore) continue;
      n++;
      for (const dim of SCORE_DIMENSIONS) {
        deltaAcc[dim] += compareScore.dimensions[dim] - baseScore.dimensions[dim];
      }
      missingDeltaAcc += compareScore.missingClaims - baseScore.missingClaims;
      hallucinationDeltaAcc += compareScore.hallucinations - baseScore.hallucinations;
    }
  }

  if (n === 0) {
    return {
      baseVariant,
      compareVariant,
      matchedPairCount: 0,
      meanDelta: zeroDimensionRecord(),
      meanMissingClaimsDelta: 0,
      meanHallucinationsDelta: 0,
    };
  }

  const meanDelta = zeroDimensionRecord();
  for (const dim of SCORE_DIMENSIONS) meanDelta[dim] = deltaAcc[dim] / n;

  return {
    baseVariant,
    compareVariant,
    matchedPairCount: n,
    meanDelta,
    meanMissingClaimsDelta: missingDeltaAcc / n,
    meanHallucinationsDelta: hallucinationDeltaAcc / n,
  };
}
