import type { MatrixReport } from "./matrix-aggregator.js";

export function renderMatrixReport(report: MatrixReport): string {
  let md = `# Claim Extraction Evaluation Matrix Report\n\n`;

  // Summary
  md += `## Executive Summary\n\n`;
  md += `- **Best Model Overall:** ${report.summary.bestModel}\n`;
  md += `- **Worst Model Overall:** ${report.summary.worstModel}\n`;
  md += `- **Hardest Video:** ${report.summary.hardestVideo}\n\n`;

  // Leaderboards
  md += `## Leaderboards\n\n`;
  const dimensions = [
    { key: "overallScore", title: "Overall Score" },
    { key: "completeness", title: "Completeness" },
    { key: "accuracy", title: "Accuracy" },
    { key: "topicCoverage", title: "Topic Coverage" },
    { key: "atomicity", title: "Atomicity" }
  ] as const;

  for (const { key, title } of dimensions) {
    md += `### ${title}\n\n`;
    md += `| Rank | Model | Score |\n`;
    md += `| --- | --- | --- |\n`;
    const ranks = report.leaderboards[key];
    if (ranks) {
      ranks.forEach((entry, i) => {
        md += `| ${i + 1} | ${entry.modelId} | ${entry.score.toFixed(2)} |\n`;
      });
    }
    md += `\n`;
  }

  // Cost Analysis
  md += `## Cost Analysis\n\n`;
  md += `| Model | Estimated Cost (USD) |\n`;
  md += `| --- | --- |\n`;
  const sortedStatsModelIds = Object.keys(report.modelStats).sort();
  for (const modelId of sortedStatsModelIds) {
    const stats = report.modelStats[modelId];
    const cost = stats?.estimatedCostUsd !== undefined ? `$${stats.estimatedCostUsd.toFixed(4)}` : "N/A";
    md += `| ${modelId} | ${cost} |\n`;
  }
  md += `\n`;

  // Model Stats Breakdown
  md += `## Model Scorecards\n\n`;
  const sortedModelIds = Object.keys(report.modelStats).sort();
  for (const modelId of sortedModelIds) {
    const stats = report.modelStats[modelId];
    if (!stats) continue;
    md += `### ${modelId}\n\n`;
    md += `| Dimension | Mean | Median | Min | Max | StdDev |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;
    for (const { key } of dimensions) {
      const dimStat = stats.dimensions[key];
      if (!dimStat) continue;
      md += `| ${key} | ${dimStat.mean.toFixed(2)} | ${dimStat.median.toFixed(2)} | ${dimStat.min.toFixed(2)} | ${dimStat.max.toFixed(2)} | ${dimStat.stddev.toFixed(2)} |\n`;
    }
    md += `\n`;
  }

  // Variant Stats Breakdown
  md += `## Variant Scorecards\n\n`;
  const sortedVariantIds = Object.keys(report.variantStats).sort();
  for (const variantId of sortedVariantIds) {
    const stats = report.variantStats[variantId];
    if (!stats) continue;
    md += `### ${variantId}\n\n`;
    md += `| Dimension | Mean | Median | Min | Max | StdDev |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;
    for (const { key } of dimensions) {
      const dimStat = stats.dimensions[key];
      if (!dimStat) continue;
      md += `| ${key} | ${dimStat.mean.toFixed(2)} | ${dimStat.median.toFixed(2)} | ${dimStat.min.toFixed(2)} | ${dimStat.max.toFixed(2)} | ${dimStat.stddev.toFixed(2)} |\n`;
    }
    md += `\n`;
  }

  // Video Stats Breakdown
  md += `## Video Heatmap\n\n`;
  const sortedVideoIds = Object.keys(report.videoStats).sort();
  for (const videoId of sortedVideoIds) {
    const stats = report.videoStats[videoId];
    if (!stats) continue;
    md += `### ${videoId}\n\n`;
    md += `| Dimension | Mean | Median | Min | Max | StdDev |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;
    for (const { key } of dimensions) {
      const dimStat = stats.dimensions[key];
      if (!dimStat) continue;
      md += `| ${key} | ${dimStat.mean.toFixed(2)} | ${dimStat.median.toFixed(2)} | ${dimStat.min.toFixed(2)} | ${dimStat.max.toFixed(2)} | ${dimStat.stddev.toFixed(2)} |\n`;
    }
    md += `\n`;
  }

  return md;
}
