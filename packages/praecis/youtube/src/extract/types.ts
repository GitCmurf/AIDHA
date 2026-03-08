import type { GraphNode } from '@aidha/graph-backend';
import type { ClaimState } from '../utils/claim-state.js';

export interface ClaimCandidate {
  text: string;
  excerptIds: string[];
  confidence?: number;
  startSeconds?: number;
  type?: string;
  classification?: string;
  domain?: string;
  why?: string;
  evidenceType?: string;
  method?: 'heuristic' | 'heuristic-fallback' | 'llm';
  chunkIndex?: number;
  model?: string;
  promptVersion?: string;
  extractorVersion?: string;
  state?: ClaimState;
  /**
   * The maximum token overlap ratio between this claim and its source excerpts.
   * Values closer to 1.0 indicate near-exact transcript copies ("echoes").
   * Values closer to 0.0 indicate synthesized/rewritten assertions.
   * Undefined means echo detection was not run or no excerpt texts were available.
   */
  echoOverlapRatio?: number;
}

export interface ClaimExtractionInput {
  resource: GraphNode;
  excerpts: GraphNode[];
  maxClaims?: number;
}

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
