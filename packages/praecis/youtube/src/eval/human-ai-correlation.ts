/**
 * Computes the Spearman rank-order correlation coefficient between two series of scores.
 */
export interface CorrelationResult {
  spearmanRho: number;
  n: number;
  isReliable: boolean;
}

/**
 * Assigns ranks to a series of numbers, handling ties by averaging.
 */
function getRanks(series: number[]): number[] {
  const sorted = [...series].map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks: number[] = new Array(series.length);

  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.value === sorted[i]!.value) {
      j++;
    }

    // Mean rank for the tie group
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[sorted[k]!.index] = rank;
    }
    i = j;
  }

  return ranks;
}

export function computeHumanAiCorrelation(
  humanScores: number[],
  aiScores: number[]
): CorrelationResult | undefined {
  if (humanScores.length !== aiScores.length || humanScores.length < 2) {
    return undefined;
  }

  // Guard against NaN / Infinity inputs
  if (humanScores.some(s => !Number.isFinite(s)) || aiScores.some(s => !Number.isFinite(s))) {
    return undefined;
  }

  const n = humanScores.length;
  const humanRanks = getRanks(humanScores);
  const aiRanks = getRanks(aiScores);

  const humanMean = humanRanks.reduce((a, b) => a + b, 0) / n;
  const aiMean = aiRanks.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomHuman = 0;
  let denomAi = 0;

  for (let i = 0; i < n; i++) {
    const hDiff = humanRanks[i]! - humanMean;
    const aiDiff = aiRanks[i]! - aiMean;
    numerator += hDiff * aiDiff;
    denomHuman += hDiff * hDiff;
    denomAi += aiDiff * aiDiff;
  }

  const denominator = Math.sqrt(denomHuman * denomAi);
  if (denominator === 0) {
    return undefined; // series is constant
  }

  const spearmanRho = numerator / denominator;

  return {
    spearmanRho,
    n,
    isReliable: n >= 15
  };
}
