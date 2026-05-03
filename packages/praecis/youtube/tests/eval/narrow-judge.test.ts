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

  it("matches gold-text fallback with case and whitespace differences", () => {
    const findings = NarrowJudgeFindingsSchema.parse({
      summary: "Tests normalized gold-text matching.",
      matchedGoldClaims: [{ goldText: "  SOME Gold TEXT  ", candidateText: "Candidate", reason: "Match" }],
      missedGoldClaims: [],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    });

    const scores = deriveNarrowJudgeScores(
      findings,
      [{ id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "some gold text", type: "fact", evidence: undefined }],
      [{ text: "Candidate", excerptIds: ["e1"] }]
    );

    expect(scores.goldCoverage).toBe(10);
  });

  it("does not award gold coverage for fabricated matched candidate text", () => {
    const findings = NarrowJudgeFindingsSchema.parse({
      summary: "A malicious judge response claims all gold claims matched fabricated candidates.",
      matchedGoldClaims: [
        { goldId: "v1:1", goldText: "Gold one", candidateText: "Fabricated candidate one", reason: "Claimed match" },
        { goldId: "v1:2", goldText: "Gold two", candidateText: "Fabricated candidate two", reason: "Claimed match" },
      ],
      missedGoldClaims: [],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    });

    const scores = deriveNarrowJudgeScores(
      findings,
      [
        { id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "Gold one", type: "fact", evidence: undefined },
        { id: "v1:2", parentId: undefined, depth: 0, path: [2], text: "Gold two", type: "fact", evidence: undefined },
      ],
      [{ text: "A real candidate that does not match the fabricated text", excerptIds: ["e1"] }]
    );

    expect(scores.goldCoverage).toBe(0);
  });

  it("still awards gold coverage when matched candidate text exists in the evaluated claim set", () => {
    const findings = NarrowJudgeFindingsSchema.parse({
      summary: "The judge matched a real candidate to a gold node.",
      matchedGoldClaims: [{ goldId: "v1:1", goldText: "Gold claim", candidateText: "Real candidate", reason: "Directly covered" }],
      missedGoldClaims: [],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    });

    const scores = deriveNarrowJudgeScores(
      findings,
      [{ id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "Gold claim", type: "fact", evidence: undefined }],
      [{ text: "Real candidate", excerptIds: ["e1"] }]
    );

    expect(scores.goldCoverage).toBe(10);
  });

  it("matches missed-root gold-text fallback with case and whitespace normalization", () => {
    const findings = NarrowJudgeFindingsSchema.parse({
      summary: "Tests normalized missed-root matching.",
      matchedGoldClaims: [],
      missedGoldClaims: [{ goldText: "  ROOT Claim  ", reason: "Missed", isRoot: false }],
      unsupportedCandidateClaims: [],
      redundantCandidateClaims: [],
      structuralIssues: [],
    });

    const scores = deriveNarrowJudgeScores(
      findings,
      [{ id: "v1:1", parentId: undefined, depth: 0, path: [1], text: "root claim", type: "fact", evidence: undefined }],
      [{ text: "Other candidate", excerptIds: ["e1"] }]
    );

    expect(scores.goldCoverage).toBe(0);
    expect(scores.structure).toBeLessThan(10);
  });
});
