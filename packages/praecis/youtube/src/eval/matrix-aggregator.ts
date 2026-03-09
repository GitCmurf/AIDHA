import type { MatrixCell, ScoreDimension } from "./matrix-runner.js";

export type StatName = "mean" | "median" | "min" | "max" | "stddev";
export type DimensionStats = Record<ScoreDimension, Record<StatName, number>>;

export interface MatrixReport {
  summary: { bestModel: string; worstModel: string; hardestVideo: string };
  modelStats: Record<string, { dimensions: DimensionStats; estimatedCostUsd?: number }>;
  videoStats: Record<string, { dimensions: DimensionStats }>;
  leaderboards: Record<ScoreDimension, { modelId: string; score: number }[]>;
}

export function aggregateMatrixResults(cells: MatrixCell[]): MatrixReport {
  const modelScores: Record<string, Record<ScoreDimension, number[]>> = Object.create(null);
  const videoScores: Record<string, Record<ScoreDimension, number[]>> = Object.create(null);

  const dimensions: ScoreDimension[] = [
    "completeness",
    "accuracy",
    "topicCoverage",
    "atomicity",
    "overallScore",
  ];

  for (const cell of cells) {
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
      for (const dim of dimensions) {
        aggregatedScore[dim] += score[dim] || 0;
      }
    }

    const judgeCount = cell.scores.length;
    for (const dim of dimensions) {
      aggregatedScore[dim] /= judgeCount;
    }

    if (!modelScores[cell.modelId]) {
      modelScores[cell.modelId] = { completeness: [], accuracy: [], topicCoverage: [], atomicity: [], overallScore: [] };
    }
    if (!videoScores[cell.videoId]) {
      videoScores[cell.videoId] = { completeness: [], accuracy: [], topicCoverage: [], atomicity: [], overallScore: [] };
    }

    for (const dim of dimensions) {
      const dimScore = aggregatedScore[dim];
      if (dimScore !== undefined) {
        modelScores[cell.modelId]![dim].push(dimScore);
        videoScores[cell.videoId]![dim].push(dimScore);
      }
    }
  }

  const modelStats: Record<string, { dimensions: DimensionStats }> = {};
  for (const [modelId, scores] of Object.entries(modelScores)) {
    modelStats[modelId] = { dimensions: calculateDimensionStats(scores) };
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

  for (const dim of dimensions) {
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
    .sort((a, b) => a.score - b.score);
  const hardestVideo = videoLeaderboard.length > 0 ? (videoLeaderboard[0]?.videoId ?? "None") : "None";

  return {
    summary: { bestModel, worstModel, hardestVideo },
    modelStats,
    videoStats,
    leaderboards,
  };
}

function calculateDimensionStats(scores: Record<ScoreDimension, number[]>): DimensionStats {
  const result: Partial<DimensionStats> = {};
  const dimensions: ScoreDimension[] = [
    "completeness",
    "accuracy",
    "topicCoverage",
    "atomicity",
    "overallScore",
  ];

  for (const dim of dimensions) {
    const values = scores[dim];
    if (!values || values.length === 0) {
      result[dim] = { mean: 0, median: 0, min: 0, max: 0, stddev: 0 };
      continue;
    }
    values.sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const min = values[0] ?? 0;
    const max = values[values.length - 1] ?? 0;
    const mid = Math.floor(values.length / 2);

    let median = 0;
    if (values.length % 2 !== 0) {
      median = values[mid] ?? 0;
    } else {
      const v1 = values[mid - 1] ?? 0;
      const v2 = values[mid] ?? 0;
      median = (v1 + v2) / 2;
    }

    const squareDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stddev = Math.sqrt(avgSquareDiff);

    result[dim] = { mean, median, min, max, stddev };
  }

  return result as DimensionStats;
}
