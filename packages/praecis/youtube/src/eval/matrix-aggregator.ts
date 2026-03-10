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

export const aggregateMatrixResults = (cells: MatrixCell[]): MatrixReport => {
  const { modelScores, variantScores, videoScores, totalExtractionUsd, totalJudgeUsd } = processCells(cells);

  const modelStats = calculateAllStats(modelScores);
  const variantStats = calculateAllStats(variantScores);
  const videoStats = calculateAllStats(videoScores);

  const leaderboards = generateLeaderboards(modelStats);
  const summary = determineSummary(leaderboards, videoStats);
  const recommendations = generateRecommendations(cells, leaderboards, variantStats);

  return {
    summary,
    recommendations,
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
};

const processCells = (cells: MatrixCell[]) => {
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

    if (cell.error || !cell.scores || cell.scores.length === 0) continue;

    const aggregatedScore = aggregateCellScores(cell.scores);

    if (!modelScores[cell.modelId]) modelScores[cell.modelId] = createEmptyScoreRecord();
    if (!variantScores[cell.extractorVariantId]) variantScores[cell.extractorVariantId] = createEmptyScoreRecord();
    if (!videoScores[cell.videoId]) videoScores[cell.videoId] = createEmptyScoreRecord();

    const mScores = modelScores[cell.modelId];
    const vntScores = variantScores[cell.extractorVariantId];
    const vdoScores = videoScores[cell.videoId];

    if (mScores && vntScores && vdoScores) {
      for (const dim of SCORE_DIMENSIONS) {
        const dimScore = aggregatedScore[dim];
        mScores[dim].push(dimScore);
        vntScores[dim].push(dimScore);
        vdoScores[dim].push(dimScore);
      }
    }
  }

  return { modelScores, variantScores, videoScores, totalExtractionUsd, totalJudgeUsd };
};

const aggregateCellScores = (scores: any[]): Record<ScoreDimension, number> => {
  const aggregated: Record<ScoreDimension, number> = {
    completeness: 0,
    accuracy: 0,
    topicCoverage: 0,
    atomicity: 0,
    overallScore: 0
  };

  for (const score of scores) {
    for (const dim of SCORE_DIMENSIONS) {
      aggregated[dim] += score[dim] || 0;
    }
  }

  const count = scores.length;
  for (const dim of SCORE_DIMENSIONS) {
    aggregated[dim] /= count;
  }

  return aggregated;
};

const calculateAllStats = (scoresMap: Record<string, Record<ScoreDimension, number[]>>): Record<string, { dimensions: DimensionStats }> => {
  const stats: Record<string, { dimensions: DimensionStats }> = {};
  for (const [id, scores] of Object.entries(scoresMap)) {
    stats[id] = { dimensions: calculateDimensionStats(scores) };
  }
  return stats;
};

const generateLeaderboards = (modelStats: Record<string, { dimensions: DimensionStats }>): Record<ScoreDimension, { modelId: string; score: number }[]> => {
  const leaderboards: any = {};

  for (const dim of SCORE_DIMENSIONS) {
    leaderboards[dim] = Object.keys(modelStats)
      .map(modelId => ({
        modelId,
        score: modelStats[modelId]?.dimensions[dim]?.mean ?? 0
      }))
      .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId));
  }

  return leaderboards;
};

const determineSummary = (leaderboards: Record<ScoreDimension, { modelId: string; score: number }[]>, videoStats: Record<string, { dimensions: DimensionStats }>) => {
  const overall = leaderboards.overallScore;
  const bestModel = overall[0]?.modelId ?? "None";
  const worstModel = overall[overall.length - 1]?.modelId ?? "None";
  const hardestVideo = findHardestVideo(videoStats);

  return { bestModel, worstModel, hardestVideo };
};

const findHardestVideo = (videoStats: Record<string, { dimensions: DimensionStats }>): string => {
  const videoLeaderboard = Object.keys(videoStats)
    .map(videoId => ({
      videoId,
      score: videoStats[videoId]?.dimensions.overallScore?.mean ?? 0
    }))
    .sort((a, b) => a.score - b.score || a.videoId.localeCompare(b.videoId));

  return videoLeaderboard[0]?.videoId ?? "None";
};

const generateRecommendations = (cells: MatrixCell[], leaderboards: Record<ScoreDimension, { modelId: string; score: number }[]>, variantStats: Record<string, { dimensions: DimensionStats }>) => {
  const bestModel = leaderboards.overallScore[0]?.modelId ?? "None";

  const bestVariant = Object.keys(variantStats)
    .map(variantId => ({
      variantId,
      score: variantStats[variantId]?.dimensions.overallScore?.mean ?? 0
    }))
    .sort((a, b) => b.score - a.score)[0]?.variantId ?? "None";

  const budgetModels = leaderboards.overallScore.filter(m => getModel(m.modelId)?.tier === "budget");
  const bestBudgetModel = budgetModels[0]?.modelId ?? "None";

  const caveats = collectCaveats(cells);

  return {
    bestDefaultModel: bestModel,
    bestBudgetModel,
    bestVariant,
    caveats,
  };
};

const collectCaveats = (cells: MatrixCell[]): string[] => {
  const caveats: string[] = [];
  if (cells.some(c => c.error)) {
    caveats.push("Some cells failed during extraction or scoring, which may skew the results.");
  }

  const maxScores = Math.max(0, ...cells.map(c => c.scores?.length ?? 0));
  if (maxScores > 1) {
    caveats.push("Multiple judges were used; scores are averaged consensus.");
  }

  for (const cell of cells) {
    if (cell.consensusScore?.isHighVariance) {
      caveats.push(`Cell ${cell.videoId} / ${cell.modelId} has high score variance.`);
    }
  }
  return caveats;
};

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
