import type { MatrixReport } from "./matrix-aggregator.js";

export interface QualityGateRegression {
  entityId: string;
  dimension: string;
  baselineScore: number;
  latestScore: number;
  tolerance: number;
}

export interface QualityGateWarning {
  entityId: string;
  reason:
    | "missing-baseline"
    | "missing-self-improvement-score"
    | "incomparable-baseline-score"
    | "incompatible-score-mode";
}

export interface SelfImprovementGateResult {
  passed: boolean;
  regressions: QualityGateRegression[];
  warnings: QualityGateWarning[];
  skipped: boolean;
  message?: string;
}

/**
 * Ensures self-improvement pass does not degrade performance relative to the baseline variant.
 */
export function checkSelfImprovementGate(
  report: MatrixReport,
  options: {
    baselineVariantId?: string;
    selfImproveVariantId?: string;
    tolerance?: number
  } = {}
): SelfImprovementGateResult {
  const {
    baselineVariantId = "editorial-pass-v1",
    selfImproveVariantId = "self-improve-v1",
    tolerance = 1.0
  } = options;

  const regressions: QualityGateRegression[] = [];
  const warnings: QualityGateWarning[] = [];
  const selfImproveCells = report.cells.filter(c => c.extractorVariantId === selfImproveVariantId);

  if (selfImproveCells.length === 0) {
    return { passed: true, regressions: [], warnings: [], skipped: true, message: `No ${selfImproveVariantId} cells found in report.` };
  }

  const hasAnyBaseline = report.cells.some(c => c.extractorVariantId === baselineVariantId);
  if (!hasAnyBaseline) {
    return {
      passed: true,
      regressions: [],
      warnings: [],
      skipped: true,
      message: `Baseline variant ${baselineVariantId} not present in matrix; self-improvement gate is inapplicable.`
    };
  }

  const baselineCellMap = new Map(
    report.cells
      .filter(c => c.extractorVariantId === baselineVariantId)
      .map(c => [`${c.videoId}|${c.modelId}|${c.promptConfigId ?? ""}|${c.chunkMode ?? ""}`, c])
  );

  for (const siCell of selfImproveCells) {
    const baselineCell = baselineCellMap.get(
      `${siCell.videoId}|${siCell.modelId}|${siCell.promptConfigId ?? ""}|${siCell.chunkMode ?? ""}`
    );

    if (!baselineCell) {
      warnings.push({
        entityId: `${siCell.videoId}/${siCell.modelId}`,
        reason: "missing-baseline",
      });
      continue;
    }

    const selfImproveHasNarrowJudgeScores = siCell.narrowJudgeResult?.derivedScores != null;
    const baselineHasNarrowJudgeScores = baselineCell.narrowJudgeResult?.derivedScores != null;
    const selfImproveHasConsensusScores = siCell.consensusScore?.mean != null;
    const baselineHasConsensusScores = baselineCell.consensusScore?.mean != null;
    const baselineHasAnyScore = baselineHasNarrowJudgeScores || baselineHasConsensusScores;
    const selfImproveHasAnyScore = selfImproveHasNarrowJudgeScores || selfImproveHasConsensusScores;

    if (
      baselineHasAnyScore &&
      !selfImproveHasAnyScore
    ) {
      warnings.push({
        entityId: `${siCell.videoId}/${siCell.modelId}`,
        reason: "missing-self-improvement-score",
      });
      continue;
    }

    if (!baselineHasAnyScore && !selfImproveHasAnyScore) {
      continue;
    }

    if (!baselineHasAnyScore && selfImproveHasAnyScore) {
      warnings.push({
        entityId: `${siCell.videoId}/${siCell.modelId}`,
        reason: "incomparable-baseline-score",
      });
      continue;
    }

    if (
      !(baselineHasNarrowJudgeScores && selfImproveHasNarrowJudgeScores) &&
      !(baselineHasConsensusScores && selfImproveHasConsensusScores)
    ) {
      warnings.push({
        entityId: `${siCell.videoId}/${siCell.modelId}`,
        reason: "incompatible-score-mode",
      });
      continue;
    }

    // Compare Narrow Judge scores if both available
    if (siCell.narrowJudgeResult?.derivedScores && baselineCell.narrowJudgeResult?.derivedScores) {
      const siScores = siCell.narrowJudgeResult.derivedScores;
      const baseScores = baselineCell.narrowJudgeResult.derivedScores;
      const dimensions = ["goldCoverage", "faithfulness", "structure", "atomicity", "overallScore"] as const;

      for (const dim of dimensions) {
        const baselineScore = Number.isFinite(baseScores[dim]) ? baseScores[dim] : 0;
        const latestScore = Number.isFinite(siScores[dim]) ? siScores[dim] : 0;
        if (baselineScore - latestScore > tolerance) {
          regressions.push({
            entityId: `${siCell.videoId}/${siCell.modelId}`,
            dimension: dim,
            baselineScore,
            latestScore,
            tolerance
          });
        }
      }
    } else if (siCell.consensusScore?.mean != null && baselineCell.consensusScore?.mean != null) {
      // Fallback to standard consensus scores if narrow judge results are missing
      const siScores = siCell.consensusScore.mean;
      const baseScores = baselineCell.consensusScore.mean;
      const dimensions = ["completeness", "accuracy", "topicCoverage", "atomicity", "overallScore"] as const;

      for (const dim of dimensions) {
        const baselineScore = Number.isFinite(baseScores[dim]) ? baseScores[dim] : 0;
        const latestScore = Number.isFinite(siScores[dim]) ? siScores[dim] : 0;
        if (baselineScore - latestScore > tolerance) {
          regressions.push({
            entityId: `${siCell.videoId}/${siCell.modelId}`,
            dimension: dim,
            baselineScore,
            latestScore,
            tolerance
          });
        }
      }
    }
  }

  return {
    passed: regressions.length === 0,
    regressions,
    warnings,
    skipped: false
  };
}
