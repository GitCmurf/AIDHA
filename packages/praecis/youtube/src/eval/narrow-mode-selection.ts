import type { ExtractionPromptPackId } from "../extract/prompt-routing.js";
import {
  PASS1_PROMPT_CONFIG_IDS,
  type Pass1PromptConfigId,
} from "../extract/prompts/pass1-claim-mining-v2.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import { getNarrowEvalChunkModes, type NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type {
  CandidateDiagnostics,
  GoldCoverageSummary,
  NarrowComparisonCandidateReport,
  NarrowComparisonVideoReport,
  NarrowRunMode,
} from "./narrow-manual-baseline.js";
import { compareOptimizationPriority } from "./narrow-optimization-ranking.js";

interface NarrowModePreset {
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  stage1Variants: ExtractorVariantId[];
  stage2Variants: ExtractorVariantId[];
  shortlistPerVideo: number;
  includeManualBaselines: boolean;
  judgeEnabled: boolean;
  enableEmbeddings: boolean;
}

interface FastTriageEscalationContext {
  topicDomain?: string;
  semanticCoverage: Pick<GoldCoverageSummary, "ratio" | "rootRatio" | "childRatio">;
  diagnostics?: Pick<CandidateDiagnostics, "promptPackId" | "retryReason">;
}

const NARROW_MODE_PRESETS: Record<NarrowRunMode, NarrowModePreset> = {
  "fast-triage": {
    chunkModes: ["large-request"],
    promptConfigs: [...PASS1_PROMPT_CONFIG_IDS],
    stage1Variants: ["raw"],
    stage2Variants: ["self-improve-v1"],
    shortlistPerVideo: 1,
    includeManualBaselines: false,
    judgeEnabled: false,
    enableEmbeddings: false,
  },
  compare: {
    chunkModes: ["large-request"],
    promptConfigs: [...PASS1_PROMPT_CONFIG_IDS],
    stage1Variants: ["raw"],
    stage2Variants: ["self-improve-v1"],
    shortlistPerVideo: 1,
    includeManualBaselines: true,
    judgeEnabled: true,
    enableEmbeddings: true,
  },
  deep: {
    chunkModes: [...getNarrowEvalChunkModes()],
    promptConfigs: [...PASS1_PROMPT_CONFIG_IDS],
    stage1Variants: ["raw", "editorial-pass-v1", "self-improve-v1"],
    stage2Variants: ["self-improve-v1"],
    shortlistPerVideo: 3,
    includeManualBaselines: true,
    judgeEnabled: true,
    enableEmbeddings: true,
  },
};

export function getNarrowModePreset(mode: NarrowRunMode): NarrowModePreset {
  return NARROW_MODE_PRESETS[mode];
}

export function intersectVariants(
  requested: ExtractorVariantId[],
  allowed: ExtractorVariantId[]
): ExtractorVariantId[] {
  const requestedSet = new Set(requested);
  return allowed.filter((variant) => requestedSet.has(variant));
}

export function shouldFastTriageEscalate(input: {
  semanticCoverage: Pick<GoldCoverageSummary, "ratio" | "rootRatio" | "childRatio">;
  diagnostics?: Pick<CandidateDiagnostics, "promptPackId" | "retryReason">;
}): boolean {
  if (input.semanticCoverage.rootRatio === 0) return true;
  if (input.semanticCoverage.ratio < 0.25) return true;
  if (input.diagnostics?.retryReason === "missing-root-claim") return true;
  const enumerationLikePack =
    input.diagnostics?.promptPackId === "enumeration-framework" ||
    input.diagnostics?.promptPackId === "business-framework" ||
    input.diagnostics?.promptPackId === "generic-hierarchy";
  return (
    enumerationLikePack &&
    input.semanticCoverage.childRatio >=
      Math.max(0.4, input.semanticCoverage.rootRatio + 0.35)
  );
}

export function selectFastTriageEscalationPack(
  input: FastTriageEscalationContext
): ExtractionPromptPackId | undefined {
  if (!shouldFastTriageEscalate(input)) return undefined;
  const normalizedDomain = input.topicDomain?.toLowerCase() ?? "";
  const currentPack = input.diagnostics?.promptPackId;
  if (
    currentPack === "clinical-risk-management" ||
    currentPack === "clinical-risk-management-v2" ||
    /(clinical|medical|cardio|lipid|health|medicine|biology)/.test(normalizedDomain)
  ) {
    return "clinical-risk-management-v2";
  }
  return "enumeration-framework-v2";
}

function isAdaptiveEscalationCandidate(candidate: NarrowComparisonCandidateReport): boolean {
  return (
    candidate.chunkMode === "small-request" &&
    (candidate.diagnostics?.promptPackId?.endsWith("-v2") ?? false)
  );
}

export function selectShortlistCandidatesForVideo(
  video: NarrowComparisonVideoReport,
  shortlistPerVideo: number,
  preferAdaptiveEscalation: boolean
): NarrowComparisonCandidateReport[] {
  const harnessCandidates = video.candidateReports.filter((candidate) =>
    candidate.sourceKind === "harness" && candidate.promptConfigId && candidate.chunkMode
  );
  const bestSemanticRatio = harnessCandidates.reduce(
    (best, candidate) => Math.max(best, candidate.semanticCoverage.ratio),
    0
  );
  const gatedHarnessCandidates = harnessCandidates.filter(
    (candidate) =>
      candidate.structuralTargetAssessment?.passesShortlistGate &&
      candidate.semanticCoverage.ratio >=
        Math.max(bestSemanticRatio - 0.1, bestSemanticRatio * 0.75)
  );
  const shortlistPool = gatedHarnessCandidates.length > 0 ? gatedHarnessCandidates : harnessCandidates;
  if (!preferAdaptiveEscalation) {
    return shortlistPool
      .slice()
      .sort(compareOptimizationPriority)
      .slice(0, shortlistPerVideo);
  }

  const escalated = shortlistPool.filter(isAdaptiveEscalationCandidate);
  if (escalated.length > 0) {
    return escalated
      .slice()
      .sort(compareOptimizationPriority)
      .slice(0, shortlistPerVideo);
  }

  return shortlistPool
    .slice()
    .sort(compareOptimizationPriority)
    .slice(0, shortlistPerVideo);
}
