import type {
  NarrowComparisonReport,
  TimeoutSource,
} from "./narrow-manual-baseline.js";

const BORDERLINE_EMBEDDING_THRESHOLD = 0.74;

function renderScore(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(2);
}

function renderTimeoutSource(source: TimeoutSource | undefined): string {
  switch (source) {
    case "llm_client_timeout": return "client-timeout";
    case "matrix_cell_timeout": return "cell-timeout";
    case "upstream_abort": return "upstream-abort";
    default: return "none";
  }
}

export function renderNarrowComparisonMarkdown(report: NarrowComparisonReport): string {
  const primaryJudgeModelId = report.metadata.judgeModelIds[0];
  let md = "# Narrow Manual Baseline Comparison\n\n";
  md += `- Run mode: \`${report.metadata.runMode}\`\n`;
  md += `- Judge enabled: \`${report.metadata.judgeEnabled}\`\n`;
  md += `- Judge models: \`${report.metadata.judgeModelIds.join(", ") || "none"}\`\n`;
  md += `- Manual baselines included: \`${report.metadata.manualBaselinesIncluded}\`\n`;
  md += `- Requested models: \`${report.metadata.requestedModels.join(", ")}\`\n`;
  md += `- Chunk modes: \`${report.metadata.chunkModes.join(", ")}\`\n`;
  md += `- Prompt configs: \`${report.metadata.promptConfigs.join(", ")}\`\n`;
  md += `- Variants: \`${report.metadata.variants.join(", ")}\`\n`;
  md += `- Teacher selection: \`${report.metadata.teacherSelectionMode}\`\n`;
  md += `- Judged top harness rows per video: \`${report.metadata.judgedTopHarnessPerVideo}\`\n`;
  md += `- Shortlist size per video: \`${report.metadata.shortlistSizePerVideo}\`\n`;
  md += `- Refined targets: \`${report.metadata.refinedTargetCount}\`\n`;
  md += `- Embedding model: \`${report.metadata.embeddingModel}\`\n`;
  md += `- Completed stages: \`${report.metadata.completedStages.join(", ")}\`\n`;
  md += `- Budget skips: ${report.metadata.budgetSkips.length > 0 ? report.metadata.budgetSkips.join(", ") : "none"}\n`;
  md += `- Stage execution: ${Object.entries(report.metadata.stageExecution).map(([stage, status]) => `${stage}=${status}`).join(", ")}\n`;
  md += `- Adaptive escalation: ${report.metadata.adaptiveEscalation ? `enabled (${report.metadata.escalatedVideos?.join(", ") || "none escalated"})` : "disabled"}\n`;
  md += `- API calls: api-requests=${report.metadata.apiCallCounts.apiRequests}, embeddings=${report.metadata.apiCallCounts.embeddingRequests}, embedding-cache-hits=${report.metadata.apiCallCounts.embeddingCacheHits}, embedding-cache-misses=${report.metadata.apiCallCounts.embeddingCacheMisses}\n`;
  md += `- Rate-limit stats: ${Object.keys(report.metadata.rateLimitStatsByModel).length > 0 ? Object.entries(report.metadata.rateLimitStatsByModel).map(([modelId, stats]) => `${modelId}:requests=${stats.requests},waitMs=${stats.waitMs}`).join(" | ") : "none"}\n`;
  md += `- Fallback model: \`${report.metadata.fallbackModelId}\`\n`;
  md += `- Fallback triggered for: ${report.metadata.fallbackTriggeredFor.length > 0 ? report.metadata.fallbackTriggeredFor.join(", ") : "none"}\n\n`;

  for (const video of report.videos) {
    md += `## ${video.videoId} - ${video.title}\n\n`;
    md += `- Transcript structure: ${video.transcriptStructureProfile.tags.length > 0 ? video.transcriptStructureProfile.tags.join(", ") : "none detected"}\n`;
    if (video.transcriptStructureProfile.cueMatches.length > 0) {
      md += `- Transcript cues: ${video.transcriptStructureProfile.cueMatches.join(" | ")}\n`;
    }
    md += "\n";
    md += "| Candidate | Source | Claims | Judge | Gold | Faith | Struct | Atomic | Semantic | Strict | Embedding | Teacher | Roots | Children | Rank | Disagree |\n";
    md += "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
    for (const candidate of video.candidateReports) {
      const primaryScores = primaryJudgeModelId ? candidate.derivedScoresByModel?.[primaryJudgeModelId] : undefined;
      md += `| ${candidate.candidateId} | ${candidate.sourceKind} | ${candidate.claimCount} | ${renderScore(primaryScores?.overallScore)} | ${renderScore(primaryScores?.goldCoverage)} | ${renderScore(primaryScores?.faithfulness)} | ${renderScore(primaryScores?.structure)} | ${renderScore(primaryScores?.atomicity)} | ${candidate.semanticCoverage.ratio.toFixed(2)} | ${candidate.strictCoverage.ratio.toFixed(2)} | ${candidate.embeddingCoverage ? candidate.embeddingCoverage.ratio.toFixed(2) : "n/a"} | ${candidate.teacherCoverage ? candidate.teacherCoverage.ratio.toFixed(2) : "n/a"} | ${candidate.semanticCoverage.rootRatio.toFixed(2)} | ${candidate.semanticCoverage.childRatio.toFixed(2)} | ${candidate.rankWithinVideo ?? "n/a"} | ${candidate.judgeDisagreement ? `yes (${candidate.judgeDisagreement.overallSpread.toFixed(2)})` : "no"} |\n`;
    }
    md += "\n";

    for (const candidate of video.candidateReports) {
      if (candidate.selectedBestForVideo) {
        md += `- \`${candidate.candidateId}\` selected as best harness configuration for this video (score=${candidate.optimizationScore?.toFixed(2) ?? "n/a"}, overall-rank=${candidate.rankOverall ?? "n/a"})\n`;
      }
      if (candidate.error) {
        md += `- \`${candidate.candidateId}\` error: ${candidate.error}\n`;
      }
      if (candidate.note) {
        md += `- \`${candidate.candidateId}\` note: ${candidate.note}\n`;
      }
      if (candidate.diagnostics) {
        md += `- \`${candidate.candidateId}\` diagnostics: timeout=${renderTimeoutSource(candidate.diagnostics.timeoutSource)}, fallback=${candidate.diagnostics.fallbackKind}, retries=${candidate.diagnostics.retryCount}, selfImproveRounds=${candidate.diagnostics.selfImproveRoundCount}, promptPack=${candidate.diagnostics.promptPackId ?? "n/a"}, routeSource=${candidate.diagnostics.routeSource ?? "n/a"}, routeConfidence=${candidate.diagnostics.routeConfidence?.toFixed(2) ?? "n/a"}, retryReason=${candidate.diagnostics.retryReason ?? "none"}, maxChunkTokens=${candidate.diagnostics.maxChunkInputTokens}\n`;
      }
      if (candidate.teacherCandidateId) {
        md += `- \`${candidate.candidateId}\` teacher: ${candidate.teacherCandidateId} (similarity=${candidate.teacherCoverage?.ratio.toFixed(2) ?? "n/a"})\n`;
      }
      if (candidate.derivedScoresByModel) {
        for (const [judgeModelId, scores] of Object.entries(candidate.derivedScoresByModel)) {
          const findings = candidate.judgeFindingsByModel?.[judgeModelId];
          md += `- \`${candidate.candidateId}\` judge ${judgeModelId}: overall=${scores.overallScore.toFixed(2)}, gold=${scores.goldCoverage.toFixed(2)}, faithfulness=${scores.faithfulness.toFixed(2)}, structure=${scores.structure.toFixed(2)}, atomicity=${scores.atomicity.toFixed(2)}, matched=${findings?.matchedGoldClaims.length ?? 0}, missed=${findings?.missedGoldClaims.length ?? 0}, unsupported=${findings?.unsupportedCandidateClaims.length ?? 0}, redundant=${findings?.redundantCandidateClaims.length ?? 0}\n`;
          const missed = findings?.missedGoldClaims.slice(0, 3).map((finding) => finding.goldText).filter(Boolean);
          if (missed && missed.length > 0) {
            md += `- \`${candidate.candidateId}\` ${judgeModelId} missed gold: ${missed.join(" | ")}\n`;
          }
          const unsupported = findings?.unsupportedCandidateClaims.slice(0, 3).map((finding) => finding.candidateText).filter(Boolean);
          if (unsupported && unsupported.length > 0) {
            md += `- \`${candidate.candidateId}\` ${judgeModelId} unsupported claims: ${unsupported.join(" | ")}\n`;
          }
        }
      }
      if (candidate.semanticCoverage.unmatchedGoldClaims.length > 0) {
        md += `- \`${candidate.candidateId}\` unmatched gold claims: ${candidate.semanticCoverage.unmatchedGoldClaims.map((claim) => claim.text).join(" | ")}\n`;
      }
      if (candidate.gapSummary && candidate.gapSummary.missingGoldRoots.length > 0) {
        md += `- \`${candidate.candidateId}\` missing gold roots: ${candidate.gapSummary.missingGoldRoots.join(" | ")}\n`;
      }
      if (candidate.gapSummary && candidate.gapSummary.missingTeacherClaims.length > 0) {
        md += `- \`${candidate.candidateId}\` missing teacher claims: ${candidate.gapSummary.missingTeacherClaims.slice(0, 5).join(" | ")}\n`;
      }
      const topNearMisses = candidate.semanticCoverage.nearestMisses
        .filter((miss) => miss.candidateText && ((miss.embeddingScore ?? 0) >= BORDERLINE_EMBEDDING_THRESHOLD || miss.proxySemanticScore >= 0.45))
        .slice(0, 3);
      if (topNearMisses.length > 0) {
        md += `- \`${candidate.candidateId}\` near misses: ${topNearMisses.map((miss) => `${miss.goldText} => ${miss.candidateText} (lex=${miss.lexicalScore.toFixed(2)}, sem=${miss.proxySemanticScore.toFixed(2)}, emb=${miss.embeddingScore?.toFixed(2) ?? "n/a"})`).join(" | ")}\n`;
      }
    }
    md += "\n";
  }

  return md;
}
