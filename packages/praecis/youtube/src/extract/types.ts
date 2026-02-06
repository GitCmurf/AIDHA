import type { GraphNode } from '@aidha/graph-backend';

export interface ClaimCandidate {
  text: string;
  excerptIds: string[];
  confidence?: number;
  startSeconds?: number;
  type?: string;
  why?: string;
  method?: 'heuristic' | 'llm';
  chunkIndex?: number;
  model?: string;
  promptVersion?: string;
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
