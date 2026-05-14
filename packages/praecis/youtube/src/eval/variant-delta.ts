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
  /** compare − base, averaged over all matched (videoId, modelId) pairs */
  meanDelta: Record<ScoreDimension, number>;
  /** compare − base for avg missingClaims array length; positive = compare has more missing claims */
  meanMissingClaimsDelta: number;
  /** compare − base for avg hallucinations array length; positive = compare has more hallucinations */
  meanHallucinationsDelta: number;
}

const zeroDimensionRecord = (): Record<ScoreDimension, number> =>
  Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, 0])) as Record<ScoreDimension, number>;

const avgDimensions = (scores: NonNullable<MatrixCell["scores"]>): Record<ScoreDimension, number> => {
  const acc = zeroDimensionRecord();
  if (scores.length === 0) return acc;
  for (const s of scores) {
    for (const dim of SCORE_DIMENSIONS) acc[dim] += s[dim];
  }
  for (const dim of SCORE_DIMENSIONS) acc[dim] /= scores.length;
  return acc;
};

const avgListLength = (
  scores: NonNullable<MatrixCell["scores"]>,
  key: "missingClaims" | "hallucinations"
): number => {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s[key].length, 0) / scores.length;
};

export function computeVariantDelta(input: VariantDeltaInput): VariantDeltaResult {
  const { cells, baseVariant, compareVariant } = input;

  const baseCells = new Map<string, MatrixCell>();
  const compareCells = new Map<string, MatrixCell>();

  for (const cell of cells) {
    if (!cell.scores || cell.scores.length === 0) continue;
    const key = `${cell.videoId}|${cell.modelId}|${cell.promptConfigId ?? ""}|${cell.chunkMode ?? ""}`;
    if (cell.extractorVariantId === baseVariant) baseCells.set(key, cell);
    else if (cell.extractorVariantId === compareVariant) compareCells.set(key, cell);
  }

  const matchedKeys = [...baseCells.keys()].filter(k => compareCells.has(k));
  const n = matchedKeys.length;

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

  const deltaAcc = zeroDimensionRecord();
  let missingDeltaAcc = 0;
  let hallucinationDeltaAcc = 0;

  for (const key of matchedKeys) {
    const base = baseCells.get(key)!;
    const compare = compareCells.get(key)!;
    const baseScores = avgDimensions(base.scores!);
    const compareScores = avgDimensions(compare.scores!);
    for (const dim of SCORE_DIMENSIONS) deltaAcc[dim] += compareScores[dim] - baseScores[dim];
    missingDeltaAcc +=
      avgListLength(compare.scores!, "missingClaims") - avgListLength(base.scores!, "missingClaims");
    hallucinationDeltaAcc +=
      avgListLength(compare.scores!, "hallucinations") - avgListLength(base.scores!, "hallucinations");
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
