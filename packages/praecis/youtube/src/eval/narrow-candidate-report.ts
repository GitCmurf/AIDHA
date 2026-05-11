import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import {
  computeCoverageByMode,
  type CoverageCacheKey,
  type EmbeddingBudgetState,
} from "./coverage-engine.js";
import {
  assessStructuralTargets,
  type TranscriptStructureProfile,
} from "./narrow-structural-targets.js";
import type {
  ComparableClaimSet,
  GoldCoverageSummary,
  NarrowComparisonCandidateReport,
  NarrowComparisonVideoReport,
} from "./narrow-report-types.js";

export interface TranscriptStructureLookupValue {
  structureProfile: TranscriptStructureProfile;
}

export function backfillTranscriptStructureProfile(
  video: NarrowComparisonVideoReport,
  transcriptByVideo: Map<string, TranscriptStructureLookupValue>
): NarrowComparisonVideoReport {
  if (video.transcriptStructureProfile) {
    return video;
  }
  const transcript = transcriptByVideo.get(video.videoId);
  return {
    ...video,
    transcriptStructureProfile: {
      tags: [...(transcript?.structureProfile.tags ?? [])],
      cueMatches: [...(transcript?.structureProfile.cueMatches ?? [])],
    },
  };
}

export async function buildCandidateReport(
  candidate: ComparableClaimSet,
  goldClaims: FlattenedGoldenClaimNode[],
  transcriptProfile: TranscriptStructureProfile,
  embeddingClient?: GeminiEmbeddingClient,
  coverageCache?: Map<CoverageCacheKey, GoldCoverageSummary>,
  budgetState?: EmbeddingBudgetState
): Promise<NarrowComparisonCandidateReport> {
  const structuralTargetAssessment = assessStructuralTargets(candidate.claims, transcriptProfile);
  const strictCoverage = await computeCoverageByMode(candidate.claims, goldClaims, "strict", undefined, coverageCache);
  const semanticCoverage = await computeCoverageByMode(candidate.claims, goldClaims, "semantic", embeddingClient, coverageCache, budgetState);
  const embeddingCoverage = embeddingClient
    ? await computeCoverageByMode(candidate.claims, goldClaims, "embedding", embeddingClient, coverageCache, budgetState)
    : undefined;

  if (candidate.error) {
    return {
      candidateId: candidate.candidateId,
      sourceKind: candidate.sourceKind,
      modelId: candidate.modelId,
      variantId: candidate.variantId,
      chunkMode: candidate.chunkMode,
      promptConfigId: candidate.promptConfigId,
      note: candidate.note,
      claimCount: candidate.claims.length,
      structuralTargetScore: structuralTargetAssessment.score,
      structuralTargetAssessment,
      strictCoverage,
      semanticCoverage,
      embeddingCoverage,
      goldCoverage: semanticCoverage,
      diagnostics: candidate.diagnostics,
      error: candidate.error,
    };
  }

  if (candidate.claims.length === 0) {
    return {
      candidateId: candidate.candidateId,
      sourceKind: candidate.sourceKind,
      modelId: candidate.modelId,
      variantId: candidate.variantId,
      chunkMode: candidate.chunkMode,
      promptConfigId: candidate.promptConfigId,
      note: [candidate.note, "No claims extracted; judge skipped"].filter(Boolean).join(" - ") || undefined,
      claimCount: 0,
      structuralTargetScore: 0,
      structuralTargetAssessment,
      strictCoverage,
      semanticCoverage,
      embeddingCoverage,
      goldCoverage: semanticCoverage,
      diagnostics: candidate.diagnostics,
    };
  }

  return {
    candidateId: candidate.candidateId,
    sourceKind: candidate.sourceKind,
    modelId: candidate.modelId,
    variantId: candidate.variantId,
    chunkMode: candidate.chunkMode,
    promptConfigId: candidate.promptConfigId,
    note: candidate.note,
    claimCount: candidate.claims.length,
    structuralTargetScore: structuralTargetAssessment.score,
    structuralTargetAssessment,
    strictCoverage,
    semanticCoverage,
    embeddingCoverage,
    goldCoverage: semanticCoverage,
    diagnostics: candidate.diagnostics,
  };
}
