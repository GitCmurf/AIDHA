import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import { DEFAULT_CLAIM_STATE, normalizeClaimState } from '../utils/claim-state.js';
import type { ClaimState } from '../utils/claim-state.js';
import { buildTimestampUrl, formatTimestamp, toNumber } from '../extract/utils.js';

/**
 * Normalizes text for token-based similarity computation.
 * Unlike normalizeText in utils.ts (which only handles whitespace),
 * this version also lowercases and removes punctuation for tokenization.
 *
 * @param text - The text to normalize
 * @returns Normalized text suitable for token similarity comparison
 */
function normalizeText(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(text: string | undefined): Set<string> {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  return new Set(tokens);
}

function overlapCount<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count += 1;
  }
  return count;
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = overlapCount(a, b);
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function primaryExcerpt(excerpts: GraphNode[]): GraphNode | undefined {
  return excerpts.slice().sort((a, b) => {
    const aStart = toNumber(a.metadata?.['start'], 0);
    const bStart = toNumber(b.metadata?.['start'], 0);
    if (aStart !== bStart) return aStart - bStart;
    return a.id.localeCompare(b.id);
  })[0];
}

export interface RelatedClaimsOptions {
  claimId: string;
  limit?: number;
  includeDrafts?: boolean;
}

export interface RelatedClaimHit {
  claimId: string;
  claimText: string;
  resourceId: string;
  resourceTitle: string;
  timestampSeconds: number;
  timestampLabel: string;
  timestampUrl?: string;
  score: number;
  sharedReferenceCount: number;
  sharedTagCount: number;
  tokenSimilarity: number;
}

export async function findRelatedClaims(
  store: GraphStore,
  options: RelatedClaimsOptions
): Promise<Result<RelatedClaimHit[]>> {
  const targetNode = await store.getNode(options.claimId);
  if (!targetNode.ok) return targetNode;
  if (!targetNode.value || targetNode.value.type !== 'Claim') {
    return { ok: false, error: new Error(`Claim not found: ${options.claimId}`) };
  }
  const targetClaim = targetNode.value;
  const targetResourceId = targetClaim.metadata?.['resourceId'] as string | undefined;

  const claimResult = await store.queryNodes({ type: 'Claim' });
  if (!claimResult.ok) return claimResult;
  const claims = claimResult.value.items;

  const resourceResult = await store.queryNodes({ type: 'Resource' });
  if (!resourceResult.ok) return resourceResult;
  const resourceMap = new Map(resourceResult.value.items.map(item => [item.id, item]));

  const excerptResult = await store.queryNodes({ type: 'Excerpt' });
  if (!excerptResult.ok) return excerptResult;
  const excerptMap = new Map(excerptResult.value.items.map(item => [item.id, item]));

  const derived = await store.getEdges({ predicate: 'claimDerivedFrom' });
  if (!derived.ok) return derived;
  const excerptIdsByClaim = new Map<string, string[]>();
  for (const edge of derived.value.items) {
    const values = excerptIdsByClaim.get(edge.subject) ?? [];
    values.push(edge.object);
    excerptIdsByClaim.set(edge.subject, values);
  }

  const refEdges = await store.getEdges({ predicate: 'claimMentionsReference' });
  if (!refEdges.ok) return refEdges;
  const refsByClaim = new Map<string, Set<string>>();
  for (const edge of refEdges.value.items) {
    const refs = refsByClaim.get(edge.subject) ?? new Set<string>();
    refs.add(edge.object);
    refsByClaim.set(edge.subject, refs);
  }

  const tagEdges = await store.getEdges({ predicate: 'aboutTag' });
  if (!tagEdges.ok) return tagEdges;
  const tagsByClaim = new Map<string, Set<string>>();
  for (const edge of tagEdges.value.items) {
    const tags = tagsByClaim.get(edge.subject) ?? new Set<string>();
    tags.add(edge.object);
    tagsByClaim.set(edge.subject, tags);
  }

  const targetRefs = refsByClaim.get(targetClaim.id) ?? new Set<string>();
  const targetTags = tagsByClaim.get(targetClaim.id) ?? new Set<string>();
  const targetTokens = tokenSet(targetClaim.content ?? targetClaim.label);
  const allowedStates = new Set<ClaimState>(
    options.includeDrafts ? ['accepted', 'draft'] : ['accepted']
  );

  const hits: RelatedClaimHit[] = [];
  for (const claim of claims) {
    if (claim.id === targetClaim.id) continue;
    const claimState = normalizeClaimState(claim.metadata?.['state']) ?? DEFAULT_CLAIM_STATE;
    if (!allowedStates.has(claimState)) continue;

    const claimResourceId = claim.metadata?.['resourceId'] as string | undefined;
    if (!claimResourceId) continue;
    const resource = resourceMap.get(claimResourceId);
    if (!resource) continue;

    const claimRefs = refsByClaim.get(claim.id) ?? new Set<string>();
    const claimTags = tagsByClaim.get(claim.id) ?? new Set<string>();
    const refOverlap = overlapCount(targetRefs, claimRefs);
    const tagOverlap = overlapCount(targetTags, claimTags);
    const textSimilarity = tokenSimilarity(targetTokens, tokenSet(claim.content ?? claim.label));

    const sameResourceBoost = targetResourceId && targetResourceId === claimResourceId ? 0.5 : 0;
    const score = refOverlap * 3 + tagOverlap * 2 + textSimilarity + sameResourceBoost;
    if (score <= 0) continue;

    const excerptIds = excerptIdsByClaim.get(claim.id) ?? [];
    const excerpts = excerptIds
      .map(id => excerptMap.get(id))
      .filter((item): item is GraphNode => Boolean(item));
    const excerpt = primaryExcerpt(excerpts);
    const timestampSeconds = excerpt ? toNumber(excerpt.metadata?.['start'], 0) : 0;
    const fallbackVideoId = claim.metadata?.['videoId'];
    const baseUrl = (resource.metadata?.['url'] as string | undefined) ??
      (typeof fallbackVideoId === 'string' && fallbackVideoId.length > 0
        ? `https://www.youtube.com/watch?v=${fallbackVideoId}`
        : undefined);

    hits.push({
      claimId: claim.id,
      claimText: String(claim.content ?? claim.label ?? '').trim(),
      resourceId: claimResourceId,
      resourceTitle: resource.label,
      timestampSeconds,
      timestampLabel: formatTimestamp(timestampSeconds),
      timestampUrl: baseUrl ? buildTimestampUrl(baseUrl, timestampSeconds) : undefined,
      score,
      sharedReferenceCount: refOverlap,
      sharedTagCount: tagOverlap,
      tokenSimilarity: Number(textSimilarity.toFixed(3)),
    });
  }

  const sorted = hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    return a.claimId.localeCompare(b.claimId);
  });

  return { ok: true, value: sorted.slice(0, options.limit ?? sorted.length) };
}
