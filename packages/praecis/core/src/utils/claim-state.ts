import type { GraphNode } from '@aidha/graph-backend';

export type ClaimState = 'draft' | 'accepted' | 'rejected';

export const DEFAULT_CLAIM_STATE: ClaimState = 'accepted';

export function normalizeClaimState(value: unknown): ClaimState | undefined {
  if (value === 'draft' || value === 'accepted' || value === 'rejected') {
    return value;
  }
  return undefined;
}

export function isClaimAccepted(claim: GraphNode): boolean {
  const state = normalizeClaimState(claim.metadata?.['state']);
  return (state ?? DEFAULT_CLAIM_STATE) === 'accepted';
}
