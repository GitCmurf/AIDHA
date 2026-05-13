import type { ClaimCandidate } from "../extract/index.js";
import { normalizeKey } from "../extract/utils.js";
import { TieredVerifier } from "../extract/verification.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import { computeClaimSetHash } from "./matrix-cache.js";
import type {
  CoverageMode,
  CoverageNearMissDetail,
  GoldCoverageSummary,
  MatchKind,
} from "./narrow-report-types.js";

const STRICT_LEXICAL_THRESHOLD = 0.3;
const SEMANTIC_PROXY_THRESHOLD = 0.6;
const EMBEDDING_THRESHOLD = 0.9;

export type CoverageCacheKey = string;
export type EmbeddingBudgetState = { remainingEmbeddingRequests: number };

interface PairScore {
  goldIndex: number;
  candidateIndex: number;
  goldClaim: FlattenedGoldenClaimNode;
  candidate: ClaimCandidate;
  exact: boolean;
  lexical: number;
  proxySemantic: number;
  embedding?: number;
}

function buildCoverageReferenceKey(nodes: FlattenedGoldenClaimNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.depth}:${normalizeKey(node.text)}`)
    .join("|");
}

function buildCoverageCacheKey(
  candidateClaims: ClaimCandidate[],
  referenceNodes: FlattenedGoldenClaimNode[],
  mode: CoverageMode,
  hasEmbeddingClient: boolean
): CoverageCacheKey {
  return `${mode}::${hasEmbeddingClient ? 1 : 0}::${computeClaimSetHash(candidateClaims)}::${buildCoverageReferenceKey(referenceNodes)}`;
}

async function scorePair(
  goldClaim: FlattenedGoldenClaimNode,
  candidate: ClaimCandidate,
  verifier: TieredVerifier,
  mode: CoverageMode,
  embeddingClient?: GeminiEmbeddingClient,
  budgetState?: EmbeddingBudgetState
): Promise<PairScore> {
  const exact = normalizeKey(candidate.text) === normalizeKey(goldClaim.text);
  const lexical = exact ? 1 : verifier.verifyLexical(goldClaim.text, [candidate.text]).overlap;
  const proxySemantic = exact ? 1 : (await verifier.verifySemantic(goldClaim.text, [candidate.text])).similarity;
  let embedding: number | undefined;

  const shouldComputeEmbedding = !exact && embeddingClient && (
    mode === "embedding"
    || (mode === "semantic"
      && lexical < STRICT_LEXICAL_THRESHOLD
      && proxySemantic < SEMANTIC_PROXY_THRESHOLD)
  );

  if (shouldComputeEmbedding) {
    if (budgetState && budgetState.remainingEmbeddingRequests < 2) {
      embedding = undefined;
    } else {
      const beforeEmbeddings = embeddingClient.getStats().embeddingsComputed;
      const embeddingResult = await embeddingClient.similarity(goldClaim.text, candidate.text);
      if (budgetState) {
        budgetState.remainingEmbeddingRequests -= embeddingClient.getStats().embeddingsComputed - beforeEmbeddings;
      }
      if (embeddingResult.ok) {
        embedding = embeddingResult.value.score;
      } else {
        embedding = undefined;
      }
    }
  }

  return {
    goldIndex: -1,
    candidateIndex: -1,
    goldClaim,
    candidate,
    exact,
    lexical,
    proxySemantic,
    embedding,
  };
}

function isPairEligible(pair: PairScore, mode: CoverageMode): boolean {
  if (pair.exact) return true;
  if (mode === "strict") {
    return pair.lexical >= STRICT_LEXICAL_THRESHOLD;
  }
  if (mode === "embedding") {
    return (pair.embedding ?? 0) >= EMBEDDING_THRESHOLD;
  }
  return pair.lexical >= STRICT_LEXICAL_THRESHOLD
    || pair.proxySemantic >= SEMANTIC_PROXY_THRESHOLD
    || (pair.embedding ?? 0) >= EMBEDDING_THRESHOLD;
}

function pairSortScore(pair: PairScore, mode: CoverageMode): number {
  if (pair.exact) return 10;
  if (mode === "strict") return pair.lexical;
  if (mode === "embedding") return pair.embedding ?? 0;
  return Math.max(pair.lexical, pair.proxySemantic, pair.embedding ?? 0);
}

function pairMatchKind(pair: PairScore, mode: CoverageMode): MatchKind {
  if (pair.exact) return "exact";
  if (mode === "strict" || pair.lexical >= STRICT_LEXICAL_THRESHOLD) return "lexical";
  if ((pair.embedding ?? 0) >= EMBEDDING_THRESHOLD) return "embedding";
  return "proxy-semantic";
}

function summarizeCoverage(
  goldClaims: FlattenedGoldenClaimNode[],
  candidateClaims: ClaimCandidate[],
  matchedPairs: PairScore[],
  mode: CoverageMode,
  nearestMisses: CoverageNearMissDetail[]
): GoldCoverageSummary {
  const matchedGoldIds = new Set(matchedPairs.map((pair) => pair.goldClaim.id));
  const matchedCandidateIndices = new Set(matchedPairs.map((pair) => pair.candidateIndex));
  const roots = goldClaims.filter((claim) => claim.depth === 0);
  const children = goldClaims.filter((claim) => claim.depth > 0);
  const rootsMatched = roots.filter((claim) => matchedGoldIds.has(claim.id)).length;
  const childrenMatched = children.filter((claim) => matchedGoldIds.has(claim.id)).length;
  const total = goldClaims.length;
  const matched = matchedPairs.length;

  return {
    matched,
    total,
    ratio: total === 0 ? 0 : matched / total,
    rootsMatched,
    rootsTotal: roots.length,
    rootRatio: roots.length === 0 ? 0 : rootsMatched / roots.length,
    childrenMatched,
    childrenTotal: children.length,
    childRatio: children.length === 0 ? 0 : childrenMatched / children.length,
    unmatchedGoldClaims: goldClaims
      .filter((claim) => !matchedGoldIds.has(claim.id))
      .map((claim) => ({ id: claim.id, text: claim.text, depth: claim.depth })),
    unmatchedCandidateClaims: candidateClaims
      .filter((_, index) => !matchedCandidateIndices.has(index))
      .map((claim) => ({ text: claim.text })),
    matchedPairs: matchedPairs.map((pair) => ({
      goldId: pair.goldClaim.id,
      goldText: pair.goldClaim.text,
      candidateText: pair.candidate.text,
      candidateIndex: pair.candidateIndex,
      kind: pairMatchKind(pair, mode),
      lexicalScore: pair.lexical,
      proxySemanticScore: pair.proxySemantic,
      embeddingScore: pair.embedding,
    })),
    nearestMisses,
  };
}

export async function computeCoverageByMode(
  candidateClaims: ClaimCandidate[],
  goldClaims: FlattenedGoldenClaimNode[],
  mode: CoverageMode,
  embeddingClient?: GeminiEmbeddingClient,
  coverageCache?: Map<CoverageCacheKey, GoldCoverageSummary>,
  budgetState?: EmbeddingBudgetState
): Promise<GoldCoverageSummary> {
  const cacheKey = buildCoverageCacheKey(candidateClaims, goldClaims, mode, !!embeddingClient);
  const cached = coverageCache?.get(cacheKey);
  if (cached) return cached;

  const verifier = new TieredVerifier();
  const allPairs: PairScore[] = [];

  for (const [goldIndex, goldClaim] of goldClaims.entries()) {
    for (const [candidateIndex, candidate] of candidateClaims.entries()) {
      const pair = await scorePair(goldClaim, candidate, verifier, mode, embeddingClient, budgetState);
      pair.goldIndex = goldIndex;
      pair.candidateIndex = candidateIndex;
      allPairs.push(pair);
    }
  }

  const eligiblePairs = allPairs
    .filter((pair) => isPairEligible(pair, mode))
    .sort((a, b) => {
      const scoreDiff = pairSortScore(b, mode) - pairSortScore(a, mode);
      if (scoreDiff !== 0) return scoreDiff;
      const embeddingDiff = (b.embedding ?? 0) - (a.embedding ?? 0);
      if (embeddingDiff !== 0) return embeddingDiff;
      return b.lexical - a.lexical;
    });

  const matchedGold = new Set<number>();
  const matchedCandidates = new Set<number>();
  const matchedPairs: PairScore[] = [];

  for (const pair of eligiblePairs) {
    if (matchedGold.has(pair.goldIndex) || matchedCandidates.has(pair.candidateIndex)) continue;
    matchedGold.add(pair.goldIndex);
    matchedCandidates.add(pair.candidateIndex);
    matchedPairs.push(pair);
  }

  const pairsByGoldIndex = new Map<number, PairScore[]>();
  for (const pair of allPairs) {
    const bucket = pairsByGoldIndex.get(pair.goldIndex);
    if (bucket) bucket.push(pair);
    else pairsByGoldIndex.set(pair.goldIndex, [pair]);
  }

  const nearestMisses: CoverageNearMissDetail[] = [];
  for (const [goldIndex, goldClaim] of goldClaims.entries()) {
    if (matchedGold.has(goldIndex)) continue;
    const nearest = (pairsByGoldIndex.get(goldIndex) ?? [])
      .sort((a, b) => {
        const scoreDiff = Math.max(b.lexical, b.proxySemantic, b.embedding ?? 0) - Math.max(a.lexical, a.proxySemantic, a.embedding ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.embedding ?? 0) - (a.embedding ?? 0);
      })[0];
    nearestMisses.push({
      goldId: goldClaim.id,
      goldText: goldClaim.text,
      candidateText: nearest?.candidate.text,
      lexicalScore: nearest?.lexical ?? 0,
      proxySemanticScore: nearest?.proxySemantic ?? 0,
      embeddingScore: nearest?.embedding,
    });
  }

  const summary = summarizeCoverage(goldClaims, candidateClaims, matchedPairs, mode, nearestMisses);
  coverageCache?.set(cacheKey, summary);
  return summary;
}
