import type { MatrixReport, DimensionStats } from "./matrix-aggregator.js";

const escapeMdTableCell = (s: string): string =>
  s.replace(/([\\|])/g, "\\$1");

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
        md += `| ${i + 1} | ${escapeMdTableCell(entry.modelId)} | ${entry.score.toFixed(2)} |\n`;
      });
    }
    md += "\n";
  }
  return md;
};

const renderExecutiveSummary = (summary: MatrixReport["summary"]): string => {
  let md = "## Executive Summary\n\n";
  md += `- **Best Model Overall:** ${escapeMdTableCell(summary.bestModel)}\n`;
  md += `- **Worst Model Overall:** ${escapeMdTableCell(summary.worstModel)}\n`;
  md += `- **Hardest Video:** ${escapeMdTableCell(summary.hardestVideo)}\n\n`;
  return md;
};

const renderHighVarianceAlerts = (caveats: string[] | undefined): string => {
  const highVarianceCells = caveats?.filter(c => c.includes("high score variance")) || [];
  if (highVarianceCells.length === 0) return "";

  let md = "### ⚠️ High Variance Alerts\n\n";
  md += "The following cells showed high disagreement between judges and should be manually reviewed:\n\n";
  for (const caveat of highVarianceCells) {
    md += `- ${escapeMdTableCell(caveat)}\n`;
  }
  md += "\n";
  return md;
};

const renderRecommendations = (recommendations: MatrixReport["recommendations"]): string => {
  if (!recommendations) return "";

  let md = "### Recommendations for Defaults\n\n";
  md += `- **Best Default Extraction Model:** ${escapeMdTableCell(recommendations.bestDefaultModel)}\n`;
  md += `- **Best Budget Model:** ${escapeMdTableCell(recommendations.bestBudgetModel)}\n`;
  md += `- **Best Variant:** ${escapeMdTableCell(recommendations.bestVariant)}\n`;

  if (Array.isArray(recommendations.caveats) && recommendations.caveats.length > 0) {
    md += "\n**Caveats:**\n";
    for (const caveat of recommendations.caveats) {
      md += `- ${escapeMdTableCell(caveat)}\n`;
    }
  }
  md += "\n";
  return md;
};

const renderCostEstimate = (cost: MatrixReport["costEstimate"]): string => {
  if (!cost || cost.totalUsd === 0) return "";

  let md = "### Total Cost Estimate\n\n";
  md += `- **Extraction:** $${cost.extractionUsd.toFixed(4)}\n`;
  md += `- **Judge:** $${cost.judgeUsd.toFixed(4)}\n`;
  md += `- **Total:** $${cost.totalUsd.toFixed(4)}\n\n`;
  return md;
};

const renderActualUsageSummary = (usage: MatrixReport["actualUsageSummary"]): string => {
  if (!usage || usage.cellsWithActualUsage === 0) return "";

  let md = "### Actual Usage Captured\n\n";
  md += `- **Cells with actual usage:** ${usage.cellsWithActualUsage}\n`;
  md += `- **Cells with estimates only:** ${usage.cellsWithEstimatedOnlyUsage}\n`;
  md += `- **Input tokens:** ${usage.inputTokens}\n`;
  md += `- **Output tokens:** ${usage.outputTokens}\n`;
  md += `- **Total tokens:** ${usage.totalTokens}\n`;
  md += `- **Actual cost:** $${usage.actualCostUsd.toFixed(4)}\n\n`;
  return md;
};

const renderVariantCostBreakdown = (variantCosts: MatrixReport["variantCostSummary"]): string => {
  if (!variantCosts || Object.keys(variantCosts).length === 0) return "";

  let md = "### Variant Cost Breakdown\n\n";
  md += "| Variant | Extraction | Judge | Total |\n";
  md += "| --- | --- | --- | --- |\n";

  const sortedVariants = Object.keys(variantCosts).sort();
  for (const variantId of sortedVariants) {
    const cost = variantCosts[variantId]!;
    md += `| ${escapeMdTableCell(variantId)} | $${cost.extractionUsd.toFixed(4)} | $${cost.judgeUsd.toFixed(4)} | $${cost.totalUsd.toFixed(4)} |\n`;
  }
  md += "\n";
  return md;
};

const renderNarrowJudgeSummary = (results: MatrixReport["narrowJudgeResults"]): string => {
  if (!results || Object.keys(results).length === 0) return "";

  let md = "## Narrow Judge Summary\n\n";
  const sortedVariants = Object.keys(results).sort();

  for (const variantId of sortedVariants) {
    md += `### Variant: ${escapeMdTableCell(variantId)}\n\n`;
    const modelResults = results[variantId]!;
    const sortedModels = Object.keys(modelResults).sort();

    for (const modelId of sortedModels) {
      md += `#### Model: ${escapeMdTableCell(modelId)}\n\n`;
      md += "| Video/Config | Coverage | Faithfulness | Structure | Atomicity | Overall |\n";
      md += "| --- | --- | --- | --- | --- | --- |\n";

      const videoResults = modelResults[modelId]!;
      const sortedVideos = Object.keys(videoResults).sort();

      for (const videoId of sortedVideos) {
        const s = videoResults[videoId];
        if (!s) continue;
        const goldCoverage = Number.isFinite(s.goldCoverage) ? s.goldCoverage : 0;
        const faithfulness = Number.isFinite(s.faithfulness) ? s.faithfulness : 0;
        const structure = Number.isFinite(s.structure) ? s.structure : 0;
        const atomicity = Number.isFinite(s.atomicity) ? s.atomicity : 0;
        const overallScore = Number.isFinite(s.overallScore) ? s.overallScore : 0;
        md += `| ${escapeMdTableCell(videoId)} | ${goldCoverage.toFixed(2)} | ${faithfulness.toFixed(2)} | ${structure.toFixed(2)} | ${atomicity.toFixed(2)} | **${overallScore.toFixed(2)}** |\n`;
      }
      md += "\n";
    }
  }
  return md;
};

const renderQualityGates = (qualityGates: MatrixReport["qualityGates"]): string => {
  if (!qualityGates) return "";

  const gate = qualityGates.selfImprovement;
  let md = "## Quality Gates\n\n";
  md += `### Self-Improvement Regression Gate: ${gate.passed ? "passed" : "failed"}\n\n`;
  if (gate.skipped) {
    md += `- Skipped: ${escapeMdTableCell(gate.message ?? "No self-improvement cells found.")}\n\n`;
    return md;
  }

  if (gate.warnings?.length) {
    md += "#### Warnings\n\n";
    md += "| Entity | Reason |\n";
    md += "| --- | --- |\n";
    for (const warning of gate.warnings) {
      md += `| ${escapeMdTableCell(warning.entityId)} | ${escapeMdTableCell(warning.reason)} |\n`;
    }
    md += "\n";
  }

  if (gate.regressions.length === 0) {
    md += "- No regressions detected.\n\n";
    return md;
  }

  md += "| Entity | Dimension | Baseline | Latest | Tolerance |\n";
  md += "| --- | --- | --- | --- | --- |\n";
  for (const regression of gate.regressions) {
    md += `| ${escapeMdTableCell(regression.entityId)} | ${escapeMdTableCell(regression.dimension)} | ${regression.baselineScore.toFixed(2)} | ${regression.latestScore.toFixed(2)} | ${regression.tolerance.toFixed(2)} |\n`;
  }
  md += "\n";
  return md;
};

const renderVariantDeltaSummary = (deltas: MatrixReport["variantDeltaSummary"]): string => {
  if (!deltas || deltas.length === 0) return "";

  let md = "## Variant Delta Summary\n\n";
  md += "Score deltas: **compare − base** (positive = compare scores higher).\n\n";

  for (const delta of deltas) {
    md += `### ${escapeMdTableCell(delta.compareVariant)} vs ${escapeMdTableCell(delta.baseVariant)}\n\n`;
    md += `Matched pairs: ${delta.matchedPairCount}\n\n`;
    md += "| Dimension | Δ Mean |\n| --- | --- |\n";
    for (const { key, title } of dimensions) {
      const v = delta.meanDelta[key];
      if (v === undefined) continue;
      const sign = v > 0 ? "+" : "";
      md += `| ${title} | ${sign}${v.toFixed(2)} |\n`;
    }
    md += `\n- **Missing claims Δ:** ${delta.meanMissingClaimsDelta >= 0 ? "+" : ""}${delta.meanMissingClaimsDelta.toFixed(2)} (positive = more missing)\n`;
    md += `- **Hallucinations Δ:** ${delta.meanHallucinationsDelta >= 0 ? "+" : ""}${delta.meanHallucinationsDelta.toFixed(2)} (positive = more hallucinations)\n\n`;
  }
  return md;
};

export const renderMatrixReport = (report: MatrixReport): string => {
  let md = "# Claim Extraction Evaluation Matrix Report\n\n";

  md += renderExecutiveSummary(report.summary);
  md += renderHighVarianceAlerts(report.recommendations?.caveats);
  md += renderRecommendations(report.recommendations);
  md += renderCostEstimate(report.costEstimate);
  md += renderActualUsageSummary(report.actualUsageSummary);
  md += renderVariantCostBreakdown(report.variantCostSummary);
  md += renderQualityGates(report.qualityGates);
  md += renderVariantDeltaSummary(report.variantDeltaSummary);
  md += renderNarrowJudgeSummary(report.narrowJudgeResults);
  md += renderLeaderboards(report);
  md += renderAllScorecards(report);

  return md;
};
