import type { ClaimCandidate } from "../extract/index.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import {
  computeCoverageByMode,
  type CoverageCacheKey,
  type EmbeddingBudgetState,
} from "./coverage-engine.js";
import type {
  ComparableClaimSet,
  GoldCoverageSummary,
  NarrowComparisonCandidateReport,
} from "./narrow-report-types.js";

export interface SelfImproveHintInput {
  teacherCandidateId?: string;
  focusAreas: string[];
  missingTeacherClaims: string[];
  extraCandidateClaims: string[];
}

function toTeacherClaimNodes(candidate: ComparableClaimSet): FlattenedGoldenClaimNode[] {
  return candidate.claims.map((claim, index) => ({
    id: `${candidate.videoId}:teacher:${index + 1}`,
    parentId: undefined,
    depth: 0,
    path: [index + 1],
    text: claim.text,
    type: claim.type ?? "fact",
    evidence: undefined,
  }));
}

export function selfImproveHintKey(
  videoId: string,
  modelId: string,
  promptConfigId: Pass1PromptConfigId | undefined,
  chunkMode: NarrowEvalChunkMode | undefined
): string {
  return [videoId, "self-improve-v1", modelId, promptConfigId ?? "baseline", chunkMode ?? "default"].join("|");
}

function looksLikeFrameworkClaim(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("framework")
    || normalized.includes("principle")
    || normalized.includes("five ")
    || normalized.includes("four ")
    || normalized.includes("includes")
    || normalized.includes("types")
    || normalized.includes("management")
    || normalized.includes("guide")
    || normalized.includes("layouts");
}

function selectTeacherCandidate(
  reports: NarrowComparisonCandidateReport[]
): NarrowComparisonCandidateReport | undefined {
  return reports
    .filter((candidate) => candidate.sourceKind === "manual-baseline")
    .slice()
    .sort((left, right) => {
      if (right.semanticCoverage.ratio !== left.semanticCoverage.ratio) {
        return right.semanticCoverage.ratio - left.semanticCoverage.ratio;
      }
      const rightHierarchy = (2 * right.semanticCoverage.rootRatio) + right.semanticCoverage.childRatio;
      const leftHierarchy = (2 * left.semanticCoverage.rootRatio) + left.semanticCoverage.childRatio;
      if (rightHierarchy !== leftHierarchy) return rightHierarchy - leftHierarchy;
      return left.semanticCoverage.unmatchedGoldClaims.length - right.semanticCoverage.unmatchedGoldClaims.length;
    })[0];
}

export async function selectTeacherComparableCandidate(
  manualCandidates: ComparableClaimSet[],
  goldClaims: FlattenedGoldenClaimNode[],
  embeddingClient?: GeminiEmbeddingClient,
  coverageCache?: Map<CoverageCacheKey, GoldCoverageSummary>
): Promise<ComparableClaimSet | undefined> {
  const scored = await Promise.all(
    manualCandidates.map(async (candidate) => ({
      candidate,
      semanticCoverage: await computeCoverageByMode(candidate.claims, goldClaims, "semantic", embeddingClient, coverageCache),
    }))
  );

  return scored
    .slice()
    .sort((left, right) => {
      if (right.semanticCoverage.ratio !== left.semanticCoverage.ratio) {
        return right.semanticCoverage.ratio - left.semanticCoverage.ratio;
      }
      const rightHierarchy = (2 * right.semanticCoverage.rootRatio) + right.semanticCoverage.childRatio;
      const leftHierarchy = (2 * left.semanticCoverage.rootRatio) + left.semanticCoverage.childRatio;
      if (rightHierarchy !== leftHierarchy) return rightHierarchy - leftHierarchy;
      return left.semanticCoverage.unmatchedGoldClaims.length - right.semanticCoverage.unmatchedGoldClaims.length;
    })[0]?.candidate;
}

export async function enrichReportsWithTeacherData(
  videoReports: NarrowComparisonCandidateReport[],
  comparableClaimSets: ComparableClaimSet[],
  embeddingClient?: GeminiEmbeddingClient,
  coverageCache?: Map<CoverageCacheKey, GoldCoverageSummary>,
  teacherEligibleCandidateIds?: Set<string>,
  budgetState?: EmbeddingBudgetState
): Promise<void> {
  const teacher = selectTeacherCandidate(videoReports);
  if (!teacher) return;

  const teacherClaims = comparableClaimSets.find((candidate) => candidate.candidateId === teacher.candidateId);
  if (!teacherClaims) return;
  const teacherNodes = toTeacherClaimNodes(teacherClaims);

  for (const report of videoReports) {
    const sourceClaims = comparableClaimSets.find((candidate) => candidate.candidateId === report.candidateId);
    if (!sourceClaims) continue;
    report.teacherCandidateId = teacher.candidateId;
    const candidateEmbeddingClient = !teacherEligibleCandidateIds || teacherEligibleCandidateIds.has(report.candidateId)
      ? embeddingClient
      : undefined;
    report.teacherCoverage = await computeCoverageByMode(sourceClaims.claims, teacherNodes, "semantic", candidateEmbeddingClient, coverageCache, budgetState);
    report.gapSummary = {
      missingGoldRoots: report.semanticCoverage.unmatchedGoldClaims
        .filter((claim) => claim.depth === 0)
        .map((claim) => claim.text),
      missingGoldFrameworkClaims: report.semanticCoverage.unmatchedGoldClaims
        .filter((claim) => looksLikeFrameworkClaim(claim.text))
        .map((claim) => claim.text),
      missingTeacherClaims: report.teacherCoverage.unmatchedGoldClaims.map((claim) => claim.text),
      extraCandidateClaims: report.semanticCoverage.unmatchedCandidateClaims.map((claim) => claim.text),
    };
  }
}

export function buildTeacherAwareHints(
  videos: Array<{ videoId: string; candidateReports: NarrowComparisonCandidateReport[] }>
): Record<string, SelfImproveHintInput> {
  const hints: Record<string, SelfImproveHintInput> = {};

  for (const video of videos) {
    for (const candidate of video.candidateReports) {
      if (candidate.sourceKind !== "harness") continue;
      if (!candidate.modelId || !candidate.promptConfigId || !candidate.chunkMode) continue;
      const hintKey = selfImproveHintKey(video.videoId, candidate.modelId, candidate.promptConfigId, candidate.chunkMode);
      const focusAreas = new Set<string>();
      if ((candidate.gapSummary?.missingGoldRoots.length ?? 0) > 0) {
        focusAreas.add("Add a clear root or umbrella claim that organizes the detailed child claims.");
      }
      if ((candidate.gapSummary?.missingGoldFrameworkClaims.length ?? 0) > 0) {
        focusAreas.add("Preserve explicit named lists, frameworks, and enumerations with clear parent-child structure.");
      }
      if ((candidate.teacherCoverage?.unmatchedGoldClaims.length ?? 0) > 0) {
        focusAreas.add("Compare against the soft teacher and add missing transcript-supported claims it covers.");
      }
      if ((candidate.gapSummary?.extraCandidateClaims.length ?? 0) > 0) {
        focusAreas.add("Trim claims that are duplicative, too narrow, or not clearly supported by the transcript.");
      }

      hints[hintKey] = {
        teacherCandidateId: candidate.teacherCandidateId,
        focusAreas: [...focusAreas],
        missingTeacherClaims: (candidate.gapSummary?.missingTeacherClaims ?? []).slice(0, 5),
        extraCandidateClaims: (candidate.gapSummary?.extraCandidateClaims ?? []).slice(0, 3),
      };
    }
  }

  return hints;
}
