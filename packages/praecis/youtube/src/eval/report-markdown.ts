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

const renderScorecardSection = (title: string, statsMap: Record<string, { dimensions: DimensionStats }>, headerLevel = "##"): string => {
  let md = `${headerLevel} ${title}\n\n`;
  const sortedIds = Object.keys(statsMap).sort();
  for (const id of sortedIds) {
    const stats = statsMap[id];
    if (!stats) continue;
    md += `### ${id}\n\n`;
    md += renderScorecardTable(stats);
    md += "\n";
  }
  return md;
};

const renderAllScorecards = (report: MatrixReport): string => {
  let md = "";
  md += renderScorecardSection("Model Scorecards", report.modelStats);
  md += renderScorecardSection("Variant Scorecards", report.variantStats);
  md += renderScorecardSection("Video Heatmap", report.videoStats);
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

const renderExecutiveSummary = (summary: MatrixReport["summary"]): string => {
  let md = "## Executive Summary\n\n";
  md += `- **Best Model Overall:** ${summary.bestModel}\n`;
  md += `- **Worst Model Overall:** ${summary.worstModel}\n`;
  md += `- **Hardest Video:** ${summary.hardestVideo}\n\n`;
  return md;
};

const renderHighVarianceAlerts = (caveats: string[] | undefined): string => {
  const highVarianceCells = caveats?.filter(c => c.includes("high score variance")) || [];
  if (highVarianceCells.length === 0) return "";

  let md = "### ⚠️ High Variance Alerts\n\n";
  md += "The following cells showed high disagreement between judges and should be manually reviewed:\n\n";
  for (const caveat of highVarianceCells) {
    md += `- ${caveat}\n`;
  }
  md += "\n";
  return md;
};

const renderRecommendations = (recommendations: MatrixReport["recommendations"]): string => {
  if (!recommendations) return "";

  let md = "### Recommendations for Defaults\n\n";
  md += `- **Best Default Extraction Model:** ${recommendations.bestDefaultModel}\n`;
  md += `- **Best Budget Model:** ${recommendations.bestBudgetModel}\n`;
  md += `- **Best Variant:** ${recommendations.bestVariant}\n`;

  if (recommendations.caveats.length > 0) {
    md += "\n**Caveats:**\n";
    for (const caveat of recommendations.caveats) {
      md += `- ${caveat}\n`;
    }
  }
  md += "\n";
  return md;
};

const renderCostEstimate = (cost: MatrixReport["costEstimate"]): string => {
  if (!cost || cost.totalUsd === 0) return "";

  let md = "### Cost Estimate\n\n";
  md += `- **Extraction:** $${cost.extractionUsd.toFixed(4)}\n`;
  md += `- **Judge:** $${cost.judgeUsd.toFixed(4)}\n`;
  md += `- **Total:** $${cost.totalUsd.toFixed(4)}\n\n`;
  return md;
};

export const renderMatrixReport = (report: MatrixReport): string => {
  let md = "# Claim Extraction Evaluation Matrix Report\n\n";

  md += renderExecutiveSummary(report.summary);
  md += renderHighVarianceAlerts(report.recommendations?.caveats);
  md += renderRecommendations(report.recommendations);
  md += renderCostEstimate(report.costEstimate);
  md += renderLeaderboards(report);
  md += renderAllScorecards(report);

  return md;
};
