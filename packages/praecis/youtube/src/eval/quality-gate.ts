import type { MatrixReport } from "./matrix-aggregator.js";

export interface QualityGateRegression {
  entityId: string;
  dimension: string;
  baselineScore: number;
  latestScore: number;
  tolerance: number;
}

export interface SelfImprovementGateResult {
  passed: boolean;
  regressions: QualityGateRegression[];
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
    baselineVariantId = "editorial-pass-v2",
    selfImproveVariantId = "self-improve-v1",
    tolerance = 1.0
  } = options;

  const regressions: QualityGateRegression[] = [];
  const selfImproveCells = report.cells.filter(c => c.extractorVariantId === selfImproveVariantId);

  if (selfImproveCells.length === 0) {
    return { passed: true, regressions: [], skipped: true, message: `No ${selfImproveVariantId} cells found in report.` };
  }

  // Group by video for like-for-like comparison
  for (const siCell of selfImproveCells) {
    if (!siCell.consensusScore) continue;

    const baselineCell = report.cells.find(c =>
      c.videoId === siCell.videoId &&
      c.modelId === siCell.modelId &&
      c.extractorVariantId === baselineVariantId
    );

    if (!baselineCell || !baselineCell.consensusScore) {
      // Missing baseline is a failure state for the gate as we cannot verify lack of regression
      return {
        passed: false,
        regressions,
        skipped: false,
        message: `Missing baseline ${baselineVariantId} for ${siCell.videoId}/${siCell.modelId}.`
      };
    }

    const siScore = siCell.consensusScore.mean.overallScore;
    const baseScore = baselineCell.consensusScore.mean.overallScore;

    if (baseScore - siScore > tolerance) {
      regressions.push({
        entityId: `${siCell.videoId}/${siCell.modelId}`,
        dimension: "overallScore",
        baselineScore: baseScore,
        latestScore: siScore,
        tolerance
      });
    }
  }

  return {
    passed: regressions.length === 0,
    regressions,
    skipped: false
  };
}
