import type { GoldenClaimNode } from "./golden-annotation-schema.js";

export interface FlattenedGoldenClaimNode {
  id: string;
  parentId?: string;
  depth: number;
  path: number[];
  text: string;
  type: string;
  evidence?: GoldenClaimNode["evidence"];
}

export interface GoldenClaimEdge {
  parentId: string;
  childId: string;
}

function makeGoldenClaimId(videoId: string, path: number[]): string {
  return `${videoId}:${path.join(".")}`;
}

function visitClaims(
  videoId: string,
  claims: GoldenClaimNode[],
  parentPath: number[] = [],
  parentId?: string
): FlattenedGoldenClaimNode[] {
  const flattened: FlattenedGoldenClaimNode[] = [];

  claims.forEach((claim, index) => {
    const path = [...parentPath, index + 1];
    const id = makeGoldenClaimId(videoId, path);

    flattened.push({
      id,
      parentId,
      depth: path.length - 1,
      path,
      text: claim.text,
      type: claim.type,
      evidence: claim.evidence,
    });

    flattened.push(...visitClaims(videoId, claim.children, path, id));
  });

  return flattened;
}

export function flattenGoldenClaimForest(
  videoId: string,
  claims: GoldenClaimNode[]
): FlattenedGoldenClaimNode[] {
  return visitClaims(videoId, claims);
}

export function buildGoldenClaimEdges(
  videoId: string,
  claims: GoldenClaimNode[]
): GoldenClaimEdge[] {
  return flattenGoldenClaimForest(videoId, claims)
    .filter((claim) => claim.parentId !== undefined)
    .map((claim) => ({
      parentId: claim.parentId as string,
      childId: claim.id,
    }));
}
