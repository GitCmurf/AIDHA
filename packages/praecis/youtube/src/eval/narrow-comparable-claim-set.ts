import type { ClaimCandidate } from "../extract/index.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type {
  CandidateDiagnostics,
  ComparableClaimSet,
  ComparableSourceKind,
  FallbackKind,
  TimeoutSource,
} from "./narrow-manual-baseline.js";

export type HarnessCandidateIdSuffix = "refine";

export interface ComparableClaimSetIndex {
  harnessByVideoId: Map<string, ComparableClaimSet[]>;
  fallbackByVideoId: Map<string, ComparableClaimSet[]>;
}

function isModelUnavailableError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("404")
    || normalized.includes("not found")
    || normalized.includes("unknown model")
    || normalized.includes("unsupported model")
    || normalized.includes("does not exist")
    || normalized.includes("invalid model");
}

function isRateLimitOrQuotaError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("429")
    || normalized.includes("quota exceeded")
    || normalized.includes("rate limit")
    || normalized.includes("billing details")
    || normalized.includes("resource exhausted")
    || normalized.includes("high demand")
    || normalized.includes("503");
}

function isFallbackOnlyCell(cell: MatrixCell): boolean {
  return cell.claimSet.length > 0 && cell.claimSet.every((claim) => claim.method === "heuristic-fallback");
}

function countFallbackClaims(cell: MatrixCell): number {
  return cell.claimSet.filter((claim) => claim.method === "heuristic-fallback").length;
}

function deriveTimeoutSource(cell: MatrixCell): TimeoutSource {
  if ((cell.extractionDiagnostics?.clientTimeoutCount ?? 0) > 0) return "llm_client_timeout";
  if (cell.error?.message?.toLowerCase().includes("extraction timeout")) return "matrix_cell_timeout";
  if ((cell.extractionDiagnostics?.upstreamAbortCount ?? 0) > 0) return "upstream_abort";
  return "none";
}

function deriveFallbackKind(cell: MatrixCell): FallbackKind {
  const fallbackClaims = countFallbackClaims(cell);
  if (fallbackClaims === 0) return "none";
  if (fallbackClaims === cell.claimSet.length) return "full";
  return "partial";
}

export function needsFallbackForModel(cells: MatrixCell[], modelId: string): boolean {
  const modelCells = cells.filter((cell) => cell.modelId === modelId);
  return modelCells.length > 0 && modelCells.every((cell) =>
    isModelUnavailableError(cell.error?.message)
      || isRateLimitOrQuotaError(cell.error?.message)
      || isFallbackOnlyCell(cell)
  );
}

function buildDiagnostics(cell: MatrixCell): CandidateDiagnostics {
  return {
    timeoutSource: deriveTimeoutSource(cell),
    retryCount: cell.extractionDiagnostics?.transportRetryCount ?? 0,
    fallbackKind: deriveFallbackKind(cell),
    transientFailureCount: cell.extractionDiagnostics?.transientFailureCount ?? 0,
    clientTimeoutCount: cell.extractionDiagnostics?.clientTimeoutCount ?? 0,
    upstreamAbortCount: cell.extractionDiagnostics?.upstreamAbortCount ?? 0,
    maxChunkInputTokens: cell.extractionDiagnostics?.maxChunkInputTokens ?? 0,
    chunkInputTokenCounts: cell.extractionDiagnostics?.chunkInputTokenCounts ?? [],
    selfImproveRoundCount: cell.extractionDiagnostics?.selfImproveRoundCount ?? 0,
    promptPackId: cell.extractionDiagnostics?.promptPackId,
    routeSource: cell.extractionDiagnostics?.routeSource,
    routeConfidence: cell.extractionDiagnostics?.routeConfidence,
    routeSignals: cell.extractionDiagnostics?.routeSignals ?? [],
    retryTriggered: cell.extractionDiagnostics?.retryTriggered,
    retryReason: cell.extractionDiagnostics?.retryReason,
    retryPromptPackId: cell.extractionDiagnostics?.retryPromptPackId,
  };
}

export function buildComparableCandidateId(
  cell: Pick<MatrixCell, "modelId" | "extractorVariantId" | "promptConfigId" | "chunkMode" | "extractionDiagnostics" | "refinementStage">,
  sourceKind: ComparableSourceKind,
  suffix?: HarnessCandidateIdSuffix
): string {
  const baseId = `${sourceKind === "manual-baseline" ? "manual" : sourceKind}/${cell.modelId}/${cell.extractorVariantId}${cell.promptConfigId ? `/${cell.promptConfigId}` : ""}${cell.chunkMode ? `/${cell.chunkMode}` : ""}${cell.extractionDiagnostics?.promptPackId ? `/${cell.extractionDiagnostics.promptPackId}` : ""}`;
  const effectiveSuffix = suffix ?? (sourceKind === "harness" && cell.refinementStage === "refined" ? "refine" : undefined);
  return effectiveSuffix ? `${baseId}/${effectiveSuffix}` : baseId;
}

export function toHarnessComparableClaimSet(
  cell: MatrixCell,
  sourceKind: ComparableSourceKind,
  note?: string,
  candidateIdSuffix?: HarnessCandidateIdSuffix
): ComparableClaimSet {
  const diagnostics = buildDiagnostics(cell);
  const fallbackClaimCount = countFallbackClaims(cell);
  const noteParts = [
    note,
    diagnostics.timeoutSource === "llm_client_timeout" ? "LLM request timed out at the client layer" : undefined,
    diagnostics.timeoutSource === "matrix_cell_timeout" ? "Matrix cell timeout fired" : undefined,
    diagnostics.timeoutSource === "upstream_abort" ? "LLM request was aborted by upstream timeout/cancellation" : undefined,
    diagnostics.fallbackKind === "full" ? "LLM extraction fell back to heuristic claims for all extracted claims" : undefined,
    diagnostics.fallbackKind === "partial" ? `Some extracted claims came from heuristic fallback (${fallbackClaimCount})` : undefined,
    isRateLimitOrQuotaError(cell.error?.message) ? "Provider request was rate-limited or unavailable" : undefined,
    diagnostics.retryCount > 0 ? `Transport retry recovered after ${diagnostics.retryCount} retry attempt(s)` : undefined,
    diagnostics.transientFailureCount > 0 ? `Transient provider errors observed (${diagnostics.transientFailureCount})` : undefined,
    diagnostics.selfImproveRoundCount > 0 ? `Self-improvement rounds: ${diagnostics.selfImproveRoundCount}` : undefined,
    diagnostics.promptPackId ? `Prompt pack: ${diagnostics.promptPackId}` : undefined,
    diagnostics.retryTriggered ? `Prompt retry: ${diagnostics.retryReason ?? "retry-triggered"} -> ${diagnostics.retryPromptPackId ?? "unknown"}` : undefined,
    diagnostics.maxChunkInputTokens > 0 ? `Max chunk input tokens: ${diagnostics.maxChunkInputTokens}` : undefined,
  ].filter(Boolean);

  return {
    videoId: cell.videoId,
    candidateId: buildComparableCandidateId(cell, sourceKind, candidateIdSuffix),
    sourceKind,

    claims: cell.claimSet,
    modelId: cell.modelId,
    variantId: cell.extractorVariantId,
    chunkMode: cell.chunkMode as NarrowEvalChunkMode | undefined,
    promptConfigId: cell.promptConfigId as Pass1PromptConfigId | undefined,
    note: noteParts.length > 0 ? noteParts.join(" - ") : undefined,
    error: cell.error?.message ?? (diagnostics.fallbackKind === "full" ? "LLM extraction degraded to heuristic fallback" : undefined),
    diagnostics,
  };
}

export function buildHarnessComparableClaimSet(
  cell: MatrixCell,
  note?: string
): ComparableClaimSet {
  return toHarnessComparableClaimSet(
    cell,
    "harness",
    note,
    cell.refinementStage === "refined" ? "refine" : undefined
  );
}

export function toManualComparableClaimSet(
  videoId: string,
  baselineId: string,
  claims: ClaimCandidate[]
): ComparableClaimSet {
  return {
    videoId,
    candidateId: `manual/${baselineId}`,
    sourceKind: "manual-baseline",
    claims,
    note: `Loaded from ${videoId}-${baselineId}.json`,
    diagnostics: {
      timeoutSource: "none",
      retryCount: 0,
      fallbackKind: "none",
      transientFailureCount: 0,
      clientTimeoutCount: 0,
      upstreamAbortCount: 0,
      maxChunkInputTokens: 0,
      chunkInputTokenCounts: [],
      selfImproveRoundCount: 0,
    },
  };
}

function appendComparableClaimSet(
  index: Map<string, ComparableClaimSet[]>,
  candidate: ComparableClaimSet
): void {
  const candidates = index.get(candidate.videoId) ?? [];
  candidates.push(candidate);
  index.set(candidate.videoId, candidates);
}

export function buildComparableClaimSetIndex(
  harnessCells: MatrixCell[],
  fallbackCells: MatrixCell[],
  fallbackNote: string
): ComparableClaimSetIndex {
  const harnessByVideoId = new Map<string, ComparableClaimSet[]>();
  const fallbackByVideoId = new Map<string, ComparableClaimSet[]>();

  for (const cell of harnessCells) {
    appendComparableClaimSet(harnessByVideoId, buildHarnessComparableClaimSet(cell));
  }
  for (const cell of fallbackCells) {
    appendComparableClaimSet(
      fallbackByVideoId,
      toHarnessComparableClaimSet(cell, "fallback-harness", fallbackNote)
    );
  }

  return { harnessByVideoId, fallbackByVideoId };
}

export function buildComparableClaimSetsForVideo(
  videoId: string,
  index: ComparableClaimSetIndex,
  manualByVideo: Map<string, ComparableClaimSet[]>,
  includeManualBaselines: boolean
): ComparableClaimSet[] {
  return [
    ...(index.harnessByVideoId.get(videoId) ?? []),
    ...(includeManualBaselines ? (manualByVideo.get(videoId) ?? []) : []),
    ...(index.fallbackByVideoId.get(videoId) ?? []),
  ];
}
