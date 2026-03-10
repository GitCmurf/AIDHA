import type { MatrixReport, DimensionStats } from "./matrix-aggregator.js";

const dimensions = [
  { key: "overallScore", title: "Overall Score" },
  { key: "completeness", title: "Completeness" },
  { key: "accuracy", title: "Accuracy" },
  { key: "topicCoverage", title: "Topic Coverage" },
  { key: "atomicity", title: "Atomicity" }
] as const;

const renderScorecardTable = (stats: { dimensions: DimensionStats }): string => {
  let md = "| Dimension | Mean | Median | Min | Max | StdDev |\n";
  md += "| --- | --- | --- | --- | --- | --- |\n";
  for (const { key } of dimensions) {
    const dimStat = stats.dimensions[key];
    if (!dimStat) continue;
    md += `| ${key} | ${dimStat.mean.toFixed(2)} | ${dimStat.median.toFixed(2)} | ${dimStat.min.toFixed(2)} | ${dimStat.max.toFixed(2)} | ${dimStat.stddev.toFixed(2)} |\n`;
  }
  return md;
};

const renderLeaderboards = (report: MatrixReport): string => {
  let md = "## Leaderboards\n\n";
  for (const { key, title } of dimensions) {
    md += `### ${title}\n\n`;
    md += "| Rank | Model | Score |\n";
    md += "| --- | --- | --- |\n";
    const ranks = report.leaderboards[key];
    if (ranks) {
      ranks.forEach((entry, i) => {
        md += `| ${i + 1} | ${entry.modelId} | ${entry.score.toFixed(2)} |\n`;
      });
    }
    md += "\n";
  }
  return md;
};

export const renderMatrixReport = (report: MatrixReport): string => {
  let md = "# Claim Extraction Evaluation Matrix Report\n\n";

  // Executive Summary
  md += "## Executive Summary\n\n";
  md += `- **Best Model Overall:** ${report.summary.bestModel}\n`;
  md += `- **Worst Model Overall:** ${report.summary.worstModel}\n`;
  md += `- **Hardest Video:** ${report.summary.hardestVideo}\n\n`;

  const highVarianceCells = report.recommendations?.caveats.filter(c => c.includes("high score variance")) || [];
  if (highVarianceCells.length > 0) {
    md += "### ⚠️ High Variance Alerts\n\n";
    md += "The following cells showed high disagreement between judges and should be manually reviewed:\n\n";
    for (const caveat of report.recommendations!.caveats) {
      if (caveat.includes("Cell ")) {
        md += `- ${caveat}\n`;
      }
    }
    md += "\n";
  }

  if (report.recommendations) {
    md += "### Recommendations for Defaults\n\n";
    md += `- **Best Default Extraction Model:** ${report.recommendations.bestDefaultModel}\n`;
    md += `- **Best Budget Model:** ${report.recommendations.bestBudgetModel}\n`;
    md += `- **Best Variant:** ${report.recommendations.bestVariant}\n`;
    if (report.recommendations.caveats.length > 0) {
      md += "\n**Caveats:**\n";
      for (const caveat of report.recommendations.caveats) {
        md += `- ${caveat}\n`;
      }
    }
    md += "\n";
  }

  if (report.costEstimate && report.costEstimate.totalUsd > 0) {
    md += "### Cost Estimate\n\n";
    md += `- **Extraction:** $${report.costEstimate.extractionUsd.toFixed(4)}\n`;
    md += `- **Judge:** $${report.costEstimate.judgeUsd.toFixed(4)}\n`;
    md += `- **Total:** $${report.costEstimate.totalUsd.toFixed(4)}\n\n`;
  }

  // Leaderboards
  md += renderLeaderboards(report);

  // Model Stats Breakdown
  md += "## Model Scorecards\n\n";
  const sortedModelIds = Object.keys(report.modelStats).sort();
  for (const modelId of sortedModelIds) {
    const stats = report.modelStats[modelId];
    if (!stats) continue;
    md += `### ${modelId}\n\n`;
    md += renderScorecardTable(stats);
    md += "\n";
  }

  // Variant Stats Breakdown
  md += "## Variant Scorecards\n\n";
  const sortedVariantIds = Object.keys(report.variantStats).sort();
  for (const variantId of sortedVariantIds) {
    const stats = report.variantStats[variantId];
    if (!stats) continue;
    md += `### ${variantId}\n\n`;
    md += renderScorecardTable(stats);
    md += "\n";
  }

  // Video Stats Breakdown
  md += "## Video Heatmap\n\n";
  const sortedVideoIds = Object.keys(report.videoStats).sort();
  for (const videoId of sortedVideoIds) {
    const stats = report.videoStats[videoId];
    if (!stats) continue;
    md += `### ${videoId}\n\n`;
    md += renderScorecardTable(stats);
    md += "\n";
  }

  return md;
};
