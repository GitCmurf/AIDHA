import type { GraphNode } from '@aidha/graph-backend';
import type { ClaimState } from '../utils/claim-state.js';
import type { ClaimQualityReason, ClaimQualityStatus } from './claim-quality.js';

export interface ClaimCandidate {
  text: string;
  excerptIds: string[];
  confidence?: number;
  startSeconds?: number;
  type?: string;
  classification?: string;
  domain?: string;
  why?: string;
  supportSummary?: string;
  rationale?: string;
  evidenceType?: string;
  method?: 'heuristic' | 'heuristic-fallback' | 'llm';
  chunkIndex?: number;
  model?: string;
  promptVersion?: string;
  extractorVersion?: string;
  state?: ClaimState;
  qualityStatus?: ClaimQualityStatus;
  qualityReasons?: ClaimQualityReason[];
  qualityScore?: number;
  trusted?: boolean;
  supportCoverage?: number;
  /**
   * The maximum token overlap ratio between this claim and its source excerpts.
   * Values closer to 1.0 indicate near-exact transcript copies ("echoes").
   * Values closer to 0.0 indicate synthesized/rewritten assertions.
   * Undefined means echo detection was not run or no excerpt texts were available.
   */
  echoOverlapRatio?: number;
}

interface ClaimExtractionInputBase {
  excerpts: GraphNode[];
  maxClaims?: number;
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal;
  /** If true, the extractor should collect and return traces if supported */
  collectTraces?: boolean;
}

export type ClaimExtractionInput = ClaimExtractionInputBase & (
  | { resource: GraphNode; resourceId?: string }
  /** Minimal legacy path for callers that cannot provide the full resource node. */
  | { resource?: undefined; resourceId: string }
);

export interface ClaimExtractor {
  extractClaims(input: ClaimExtractionInput): Promise<ClaimCandidate[]>;
}

export interface ClaimExtractionResult {
  resourceId: string;
  claimsCreated: number;
  claimsUpdated: number;
  claimsNoop: number;
  edgesCreated: number;
  edgesUpdated: number;
  edgesNoop: number;
}

export interface ReferenceExtractionResult {
  resourceId: string;
  referencesCreated: number;
  referencesUpdated: number;
  referencesNoop: number;
  edgesCreated: number;
  edgesUpdated: number;
  edgesNoop: number;
}
