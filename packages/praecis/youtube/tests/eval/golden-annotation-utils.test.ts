import { describe, expect, it } from "vitest";
import {
  buildGoldenClaimEdges,
  flattenGoldenClaimForest,
} from "../../src/eval/golden-annotation-utils";

describe("Golden Annotation Utilities", () => {
  it("should flatten nested claims using deterministic preorder ids", () => {
    const claims = [
      {
        text: "Root claim",
        type: "research_finding",
        children: [
          {
            text: "Child claim",
            type: "fact",
            children: []
          },
          {
            text: "Second child claim",
            type: "recommendation",
            children: [
              {
                text: "Grandchild claim",
                type: "assertion",
                children: []
              }
            ]
          }
        ]
      }
    ];

    const flattened = flattenGoldenClaimForest("video-1", claims);

    expect(flattened).toEqual([
      {
        id: "video-1:1",
        parentId: undefined,
        depth: 0,
        path: [1],
        text: "Root claim",
        type: "research_finding",
        evidence: undefined,
      },
      {
        id: "video-1:1.1",
        parentId: "video-1:1",
        depth: 1,
        path: [1, 1],
        text: "Child claim",
        type: "fact",
        evidence: undefined,
      },
      {
        id: "video-1:1.2",
        parentId: "video-1:1",
        depth: 1,
        path: [1, 2],
        text: "Second child claim",
        type: "recommendation",
        evidence: undefined,
      },
      {
        id: "video-1:1.2.1",
        parentId: "video-1:1.2",
        depth: 2,
        path: [1, 2, 1],
        text: "Grandchild claim",
        type: "assertion",
        evidence: undefined,
      }
    ]);
  });

  it("should derive parent-child edges from a nested claim forest", () => {
    const claims = [
      {
        text: "Root claim",
        type: "research_finding",
        children: [
          {
            text: "Child claim",
            type: "fact",
            children: []
          }
        ]
      }
    ];

    const edges = buildGoldenClaimEdges("video-1", claims);

    expect(edges).toEqual([
      {
        parentId: "video-1:1",
        childId: "video-1:1.1",
      }
    ]);
  });
});
