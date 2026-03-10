import { getModel } from "./model-registry.js";
import { SCORE_DIMENSIONS } from "./scoring-rubric.js";
import type { MatrixCell, ScoreDimension } from "./matrix-runner.js";

export type StatName = "mean" | "median" | "min" | "max" | "stddev";
export type DimensionStats = Record<ScoreDimension, Record<StatName, number>>;

export interface MatrixReport {
  summary: { bestModel: string; worstModel: string; hardestVideo: string };
  recommendations?: {
    bestDefaultModel: string;
    bestBudgetModel: string;
    bestVariant: string;
    caveats: string[];
  };
  costEstimate?: {
    extractionUsd: number;
    judgeUsd: number;
    totalUsd: number;
  };
  modelStats: Record<string, { dimensions: DimensionStats }>;
  variantStats: Record<string, { dimensions: DimensionStats }>;
  videoStats: Record<string, { dimensions: DimensionStats }>;
  leaderboards: Record<ScoreDimension, { modelId: string; score: number }[]>;
  cells: MatrixCell[];
}

/**
 * Creates an empty score record with all dimensions initialized to empty arrays.
 */
function createEmptyScoreRecord(): Record<ScoreDimension, number[]> {
  return {
    completeness: [],
    accuracy: [],
    topicCoverage: [],
    atomicity: [],
    overallScore: []
  };
}

export function aggregateMatrixResults(cells: MatrixCell[]): MatrixReport {
  const modelScores: Record<string, Record<ScoreDimension, number[]>> = Object.create(null);
  const variantScores: Record<string, Record<ScoreDimension, number[]>> = Object.create(null);
  const videoScores: Record<string, Record<ScoreDimension, number[]>> = Object.create(null);

  let totalExtractionUsd = 0;
  let totalJudgeUsd = 0;

  for (const cell of cells) {
    if (cell.costEstimate) {
      totalExtractionUsd += cell.costEstimate.extractionUsd;
      totalJudgeUsd += cell.costEstimate.judgeUsd;
    }

    if (cell.error) continue;
    if (!cell.scores || cell.scores.length === 0) continue;

    // Aggregate consensus if multiple judges
    const aggregatedScore: Record<ScoreDimension, number> = {
      completeness: 0,
      accuracy: 0,
      topicCoverage: 0,
      atomicity: 0,
      overallScore: 0
    };

    for (const score of cell.scores) {
      for (const dim of SCORE_DIMENSIONS) {
        aggregatedScore[dim] += score[dim] || 0;
      }
    }

    const judgeCount = cell.scores.length;
    for (const dim of SCORE_DIMENSIONS) {
      aggregatedScore[dim] /= judgeCount;
    }

    if (!modelScores[cell.modelId]) {
      modelScores[cell.modelId] = createEmptyScoreRecord();
    }
    if (!variantScores[cell.extractorVariantId]) {
      variantScores[cell.extractorVariantId] = createEmptyScoreRecord();
    }
    if (!videoScores[cell.videoId]) {
      videoScores[cell.videoId] = createEmptyScoreRecord();
    }

    for (const dim of SCORE_DIMENSIONS) {
      const dimScore = aggregatedScore[dim];
      if (dimScore !== undefined) {
        modelScores[cell.modelId]![dim].push(dimScore);
        variantScores[cell.extractorVariantId]![dim].push(dimScore);
        videoScores[cell.videoId]![dim].push(dimScore);
      }
    }
  }

  const modelStats: Record<string, { dimensions: DimensionStats }> = {};
  for (const [modelId, scores] of Object.entries(modelScores)) {
    modelStats[modelId] = { dimensions: calculateDimensionStats(scores) };
  }

  const variantStats: Record<string, { dimensions: DimensionStats }> = {};
  for (const [variantId, scores] of Object.entries(variantScores)) {
    variantStats[variantId] = { dimensions: calculateDimensionStats(scores) };
  }

  const videoStats: Record<string, { dimensions: DimensionStats }> = {};
  for (const [videoId, scores] of Object.entries(videoScores)) {
    videoStats[videoId] = { dimensions: calculateDimensionStats(scores) };
  }

  const leaderboards: Record<ScoreDimension, { modelId: string; score: number }[]> = {
    completeness: [],
    accuracy: [],
    topicCoverage: [],
    atomicity: [],
    overallScore: []
  };

  for (const dim of SCORE_DIMENSIONS) {
    const sorted = Object.keys(modelStats)
      .map(modelId => {
        const mean = modelStats[modelId]?.dimensions[dim]?.mean ?? 0;
        return { modelId, score: mean };
      })
      .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId)); // tiebreaker by name
    leaderboards[dim] = sorted;
  }

  const overallLeaderboard = leaderboards.overallScore;
  const bestModel = overallLeaderboard.length > 0 ? (overallLeaderboard[0]?.modelId ?? "None") : "None";
  const worstModel = overallLeaderboard.length > 0 ? (overallLeaderboard[overallLeaderboard.length - 1]?.modelId ?? "None") : "None";

  const videoLeaderboard = Object.keys(videoStats)
    .map(videoId => {
        const mean = videoStats[videoId]?.dimensions.overallScore?.mean ?? 0;
        return { videoId, score: mean };
    })
    .sort((a, b) => a.score - b.score || a.videoId.localeCompare(b.videoId));
  const hardestVideo = videoLeaderboard.length > 0 ? (videoLeaderboard[0]?.videoId ?? "None") : "None";

  // Recommendation Logic
  const bestVariant = Object.keys(variantStats)
    .map(variantId => ({ variantId, score: variantStats[variantId]?.dimensions.overallScore?.mean ?? 0 }))
    .sort((a, b) => b.score - a.score)[0]?.variantId ?? "None";

  const budgetModels = overallLeaderboard.filter(m => getModel(m.modelId)?.tier === "budget");
  const bestBudgetModel = budgetModels.length > 0 ? budgetModels[0]!.modelId : "None";

  const caveats: string[] = [];
  if (cells.some(c => c.error)) {
    caveats.push("Some cells failed during extraction or scoring, which may skew the results.");
  }
  if (cells.length > 0 && cells[0]?.scores && cells[0]!.scores!.length > 1) {
    caveats.push("Multiple judges were used; scores are averaged consensus.");
  }
  for (const cell of cells) {
    if (cell.consensusScore?.isHighVariance) {
      caveats.push(`Cell ${cell.videoId} / ${cell.modelId} has high score variance.`);
    }
  }

  return {
    summary: { bestModel, worstModel, hardestVideo },
    recommendations: {
      bestDefaultModel: bestModel,
      bestBudgetModel,
      bestVariant,
      caveats,
    },
    costEstimate: {
      extractionUsd: totalExtractionUsd,
      judgeUsd: totalJudgeUsd,
      totalUsd: totalExtractionUsd + totalJudgeUsd
    },
    modelStats,
    variantStats,
    videoStats,
    leaderboards,
    cells,
  };
}

function calculateDimensionStats(scores: Record<ScoreDimension, number[]>): DimensionStats {
  const result: Partial<DimensionStats> = {};

  for (const dim of SCORE_DIMENSIONS) {
    const values = scores[dim];
    if (!values || values.length === 0) {
      result[dim] = { mean: 0, median: 0, min: 0, max: 0, stddev: 0 };
      continue;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const mid = Math.floor(sorted.length / 2);

    let median = 0;
    if (sorted.length % 2 !== 0) {
      median = sorted[mid] ?? 0;
    } else {
      const v1 = sorted[mid - 1] ?? 0;
      const v2 = sorted[mid] ?? 0;
      median = (v1 + v2) / 2;
    }

    const squareDiffs = sorted.map(v => Math.pow(v - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / sorted.length;
    const stddev = Math.sqrt(avgSquareDiff);

    result[dim] = { mean, median, min, max, stddev };
  }

  return result as DimensionStats;
}
