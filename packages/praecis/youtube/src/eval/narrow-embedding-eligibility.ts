import type { MatrixCell } from "./matrix-runner.js";
import type { NarrowShortlistTarget } from "./stage-artifact-store.js";
import { buildComparableCandidateId } from "./narrow-comparable-claim-set.js";
import type { ComparableClaimSet } from "./narrow-manual-baseline.js";

export interface BuildEmbeddingEligibilityInput {
  shortlistTargets: NarrowShortlistTarget[];
  refinedSelfImproveCells: MatrixCell[];
  manualByVideo: Map<string, ComparableClaimSet[]>;
  includeManualBaselines: boolean;
}

export function buildEmbeddingEligibleCandidateIdsByVideo(
  input: BuildEmbeddingEligibilityInput
): Map<string, Set<string>> {
  const embeddingEligibleCandidateIdsByVideo = new Map<string, Set<string>>();

  for (const target of input.shortlistTargets) {
    const set = embeddingEligibleCandidateIdsByVideo.get(target.videoId) ?? new Set<string>();
    set.add(target.candidateId);
    embeddingEligibleCandidateIdsByVideo.set(target.videoId, set);
  }

  for (const cell of input.refinedSelfImproveCells) {
    const set = embeddingEligibleCandidateIdsByVideo.get(cell.videoId) ?? new Set<string>();
    set.add(buildComparableCandidateId(cell, "harness"));
    embeddingEligibleCandidateIdsByVideo.set(cell.videoId, set);
  }

  if (input.includeManualBaselines) {
    for (const [videoId, manualCandidates] of input.manualByVideo.entries()) {
      const set = embeddingEligibleCandidateIdsByVideo.get(videoId) ?? new Set<string>();
      for (const candidate of manualCandidates) {
        set.add(candidate.candidateId);
      }
      embeddingEligibleCandidateIdsByVideo.set(videoId, set);
    }
  }

  return embeddingEligibleCandidateIdsByVideo;
}
