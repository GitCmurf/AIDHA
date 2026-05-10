import type {
  NarrowComparisonCandidateReport,
  NarrowComparisonVideoReport,
} from "./narrow-manual-baseline.js";

export function computeOptimizationScore(candidate: NarrowComparisonCandidateReport): number | undefined {
  if (candidate.sourceKind !== "harness" && candidate.sourceKind !== "fallback-harness") {
    return undefined;
  }
  const hierarchyScore = (2 * candidate.semanticCoverage.rootRatio) + candidate.semanticCoverage.childRatio;
  const structuralTargetBonus = (candidate.structuralTargetScore ?? 0) * 15;
  const unmatchedPenalty = candidate.semanticCoverage.unmatchedGoldClaims.length;
  const teacherBonus = (candidate.teacherCoverage?.ratio ?? 0) * 15;
  const fallbackPenalty = candidate.diagnostics?.fallbackKind === "full"
    ? 5
    : candidate.diagnostics?.fallbackKind === "partial"
      ? 2
      : 0;
  const tokenPenalty = (candidate.diagnostics?.maxChunkInputTokens ?? 0) / 10000;
  return (candidate.semanticCoverage.ratio * 100)
    + teacherBonus
    + (hierarchyScore * 10)
    + structuralTargetBonus
    - unmatchedPenalty
    - fallbackPenalty
    - tokenPenalty;
}

export function compareOptimizationPriority(
  left: NarrowComparisonCandidateReport,
  right: NarrowComparisonCandidateReport
): number {
  const leftScore = left.optimizationScore ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.optimizationScore ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) return rightScore - leftScore;
  if (right.semanticCoverage.ratio !== left.semanticCoverage.ratio) {
    return right.semanticCoverage.ratio - left.semanticCoverage.ratio;
  }
  if ((right.teacherCoverage?.ratio ?? 0) !== (left.teacherCoverage?.ratio ?? 0)) {
    return (right.teacherCoverage?.ratio ?? 0) - (left.teacherCoverage?.ratio ?? 0);
  }
  if ((right.structuralTargetScore ?? 0) !== (left.structuralTargetScore ?? 0)) {
    return (right.structuralTargetScore ?? 0) - (left.structuralTargetScore ?? 0);
  }
  const rightHierarchy = (2 * right.semanticCoverage.rootRatio) + right.semanticCoverage.childRatio;
  const leftHierarchy = (2 * left.semanticCoverage.rootRatio) + left.semanticCoverage.childRatio;
  if (rightHierarchy !== leftHierarchy) return rightHierarchy - leftHierarchy;
  if (right.semanticCoverage.unmatchedGoldClaims.length !== left.semanticCoverage.unmatchedGoldClaims.length) {
    return left.semanticCoverage.unmatchedGoldClaims.length - right.semanticCoverage.unmatchedGoldClaims.length;
  }
  return (left.diagnostics?.maxChunkInputTokens ?? Number.MAX_SAFE_INTEGER)
    - (right.diagnostics?.maxChunkInputTokens ?? Number.MAX_SAFE_INTEGER);
}

export function annotateOptimizationRanks(videos: NarrowComparisonVideoReport[]): void {
  const harnessCandidates: NarrowComparisonCandidateReport[] = [];

  for (const video of videos) {
    for (const candidate of video.candidateReports) {
      candidate.optimizationScore = computeOptimizationScore(candidate);
    }

    const ranked = video.candidateReports
      .filter((candidate) => candidate.optimizationScore !== undefined)
      .slice()
      .sort(compareOptimizationPriority);
    ranked.forEach((candidate, index) => {
      candidate.rankWithinVideo = index + 1;
      candidate.selectedBestForVideo = index === 0;
      harnessCandidates.push(candidate);
    });
  }

  harnessCandidates
    .slice()
    .sort(compareOptimizationPriority)
    .forEach((candidate, index) => {
      candidate.rankOverall = index + 1;
      candidate.selectedBestOverall = index === 0;
    });
}
