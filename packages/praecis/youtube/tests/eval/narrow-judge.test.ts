import { describe, expect, it } from "vitest";
import { buildNarrowJudgePrompt } from "../../src/eval/prompts/judge-narrow-claim-quality";
import { deriveNarrowJudgeScores, NarrowJudgeFindingsSchema } from "../../src/eval/narrow-judge";

describe("narrow judge prompt and scoring", () => {
  it("includes gold and teacher references in the prompt", () => {
    const prompt = buildNarrowJudgePrompt(
      "Transcript body",
      [{ text: "Candidate claim", excerptIds: ["e1"] }],
      [{ id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "Gold claim", type: "fact", evidence: undefined }],
      [{ text: "Teacher claim", excerptIds: ["t1"] }],
      { videoId: "v1", title: "Video", channelName: "Channel" }
    );

    expect(prompt.user).toContain("<GOLD_CLAIMS>");
    expect(prompt.user).toContain("<TEACHER_CLAIMS>");
    expect(prompt.user).toContain("Teacher claims are supplemental");
  });

  it("derives judge scores in code from structured findings", () => {
    const findings = NarrowJudgeFindingsSchema.parse({
      summary: "Mostly good but misses one root and contains one unsupported claim.",
      matchedGoldClaims: [{ goldText: "Gold claim", candidateText: "Candidate claim", reason: "Directly covered" }],
      missedGoldClaims: [{ goldText: "Missed root", reason: "Missing umbrella claim", isRoot: true }],
      unsupportedCandidateClaims: [{ candidateText: "Unsupported claim", reason: "Not grounded" }],
      redundantCandidateClaims: [{ candidateText: "Duplicate claim", reason: "Duplicate wording" }],
      structuralIssues: [{ issue: "missing-root-claim", reason: "No umbrella claim", severity: "high" }],
    });

    const scores = deriveNarrowJudgeScores(
      findings,
      [
        { id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "Gold claim", type: "fact", evidence: undefined },
        { id: "v1:2", parentId: undefined, depth: 0, path: [2], text: "Missed root", type: "fact", evidence: undefined },
      ],
      [
        { text: "Candidate claim", excerptIds: ["e1"] },
        { text: "Unsupported claim", excerptIds: ["e2"] },
        { text: "Duplicate claim", excerptIds: ["e3"] },
      ]
    );

    expect(scores.goldCoverage).toBe(5);
    expect(scores.faithfulness).toBeLessThan(10);
    expect(scores.structure).toBeLessThan(scores.faithfulness);
    expect(scores.overallScore).toBeGreaterThan(0);
  });

  it("ignores unsupported and redundant findings for stale candidate text", () => {
    const findings = NarrowJudgeFindingsSchema.parse({
      summary: "Findings include stale candidates from an old judge cache.",
      matchedGoldClaims: [{ goldText: "Gold claim", candidateText: "Current claim", reason: "Directly covered" }],
      missedGoldClaims: [],
      unsupportedCandidateClaims: [
        { candidateText: "Current unsupported claim", reason: "Not grounded" },
        { candidateText: "Stale unsupported claim", reason: "Not present in current candidates" },
      ],
      redundantCandidateClaims: [
        { candidateText: "Current redundant claim", reason: "Duplicate wording" },
        { candidateText: "Stale redundant claim", reason: "Not present in current candidates" },
      ],
      structuralIssues: [],
    });

    const scores = deriveNarrowJudgeScores(
      findings,
      [{ id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "Gold claim", type: "fact", evidence: undefined }],
      [
        { text: "Current claim", excerptIds: ["e1"] },
        { text: "Current unsupported claim", excerptIds: ["e2"] },
        { text: "Current redundant claim", excerptIds: ["e3"] },
      ]
    );

    expect(scores.faithfulness).toBeCloseTo(6.67, 2);
    expect(scores.atomicity).toBeCloseTo(6.67, 2);
  });
});
