import type { ClaimCandidate } from "../extract/index.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { NarrowDerivedJudgeScores, NarrowJudgeFindings } from "./narrow-judge.js";

export type NarrowRunMode = "fast-triage" | "compare" | "deep";
export type NarrowStageId = "shortlist" | "refine" | "score" | "judge" | "report";

export type ComparableSourceKind = "harness" | "manual-baseline" | "fallback-harness";
export type CoverageMode = "strict" | "semantic" | "embedding";
export type MatchKind = "exact" | "lexical" | "proxy-semantic" | "embedding";
export type FallbackKind = "none" | "partial" | "full";
export type TimeoutSource = "none" | "llm_client_timeout" | "matrix_cell_timeout" | "upstream_abort";

export interface CandidateDiagnostics {
  timeoutSource: TimeoutSource;
  retryCount: number;
  fallbackKind: FallbackKind;
  transientFailureCount: number;
  clientTimeoutCount: number;
  upstreamAbortCount: number;
  maxChunkInputTokens: number;
  chunkInputTokenCounts: number[];
  selfImproveRoundCount: number;
  promptPackId?: string;
  routeSource?: string;
  routeConfidence?: number;
  routeSignals?: string[];
  retryTriggered?: boolean;
  retryReason?: string;
  retryPromptPackId?: string;
}

export interface ComparableClaimSet {
  videoId: string;
  candidateId: string;
  sourceKind: ComparableSourceKind;
  claims: ClaimCandidate[];
  modelId?: string;
  variantId?: string;
  chunkMode?: NarrowEvalChunkMode;
  promptConfigId?: Pass1PromptConfigId;
  note?: string;
  error?: string;
  diagnostics?: CandidateDiagnostics;
}

export interface CoverageMatchDetail {
  goldId: string;
  goldText: string;
  candidateText: string;
  candidateIndex: number;
  kind: MatchKind;
  lexicalScore: number;
  proxySemanticScore: number;
  embeddingScore?: number;
}

export interface CoverageNearMissDetail {
  goldId: string;
  goldText: string;
  candidateText?: string;
  lexicalScore: number;
  proxySemanticScore: number;
  embeddingScore?: number;
}

export interface GoldCoverageSummary {
  matched: number;
  total: number;
  ratio: number;
  rootsMatched: number;
  rootsTotal: number;
  rootRatio: number;
  childrenMatched: number;
  childrenTotal: number;
  childRatio: number;
  unmatchedGoldClaims: Array<{ id: string; text: string; depth: number }>;
  unmatchedCandidateClaims: Array<{ text: string }>;
  matchedPairs: CoverageMatchDetail[];
  nearestMisses: CoverageNearMissDetail[];
}

export interface NarrowComparisonCandidateReport {
  candidateId: string;
  sourceKind: ComparableSourceKind;
  modelId?: string;
  variantId?: string;
  chunkMode?: NarrowEvalChunkMode;
  promptConfigId?: Pass1PromptConfigId;
  note?: string;
  claimCount: number;
  structuralTargetScore?: number;
  structuralTargetAssessment?: {
    hasRootCardinalityClaim: boolean;
    hasMemberListClaim: boolean;
    hasAvoidRuleClaim: boolean;
    passesShortlistGate: boolean;
  };
  optimizationScore?: number;
  rankWithinVideo?: number;
  rankOverall?: number;
  selectedBestForVideo?: boolean;
  selectedBestOverall?: boolean;
  judgeFindingsByModel?: Record<string, NarrowJudgeFindings>;
  derivedScoresByModel?: Record<string, NarrowDerivedJudgeScores>;
  judgeDisagreement?: {
    models: string[];
    overallSpread: number;
    goldCoverageSpread: number;
  };
  strictCoverage: GoldCoverageSummary;
  semanticCoverage: GoldCoverageSummary;
  embeddingCoverage?: GoldCoverageSummary;
  teacherCandidateId?: string;
  teacherCoverage?: GoldCoverageSummary;
  gapSummary?: {
    missingGoldRoots: string[];
    missingGoldFrameworkClaims: string[];
    missingTeacherClaims: string[];
    extraCandidateClaims: string[];
  };
  goldCoverage: GoldCoverageSummary;
  diagnostics?: CandidateDiagnostics;
  error?: string;
}

export interface NarrowComparisonVideoReport {
  videoId: string;
  title: string;
  transcriptStructureProfile: {
    tags: string[];
    cueMatches: string[];
  };
  candidateReports: NarrowComparisonCandidateReport[];
}

export interface NarrowComparisonReport {
  metadata: {
    startedAt: string;
    completedAt: string;
    runMode: NarrowRunMode;
    judgeModelIds: string[];
    requestedModels: string[];
    chunkModes: NarrowEvalChunkMode[];
    promptConfigs: Pass1PromptConfigId[];
    variants: string[];
    teacherSelectionMode: string;
    judgedTopHarnessPerVideo: number;
    fallbackModelId: string;
    fallbackTriggeredFor: string[];
    manualBaselineDir: string;
    transcriptDir: string;
    shortlistSizePerVideo: number;
    refinedTargetCount: number;
    embeddingModel: string;
    completedStages: NarrowStageId[];
    budgetSkips: string[];
    stageExecution: Record<NarrowStageId, "resumed" | "recomputed" | "skipped">;
    judgeEnabled: boolean;
    manualBaselinesIncluded: boolean;
    apiCallCounts: {
      apiRequests: number;
      embeddingRequests: number;
      embeddingCacheHits: number;
      embeddingCacheMisses: number;
    };
    rateLimitStatsByModel: Record<string, { requests: number; waitMs: number }>;
    adaptiveEscalation?: boolean;
    escalatedVideos?: string[];
    escalationReasonsByVideo?: Record<string, string[]>;
  };
  videos: NarrowComparisonVideoReport[];
}
