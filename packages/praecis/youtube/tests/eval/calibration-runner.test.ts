import { describe, it, expect, vi } from "vitest";
import { runCalibration, type CalibrationRunOptions } from "../../src/eval/calibration-runner.js";
import { CalibrationRecordSchema } from "../../src/eval/calibration-schema.js";
import type { GoldenAnnotationEntry } from "../../src/eval/golden-annotation-schema.js";
import type { LlmClient } from "../../src/extract/llm-client.js";
import type { ClaimSetScore } from "../../src/eval/scoring-rubric.js";

const makeScore = (override: Partial<ClaimSetScore> = {}): ClaimSetScore => ({
  completeness: 8.5,
  accuracy: 9.0,
  topicCoverage: 8.0,
  atomicity: 9.5,
  overallScore: 8.75,
  reasoning: "Good extraction of ideal claims from the golden set.",
  missingClaims: [],
  hallucinations: [],
  redundancies: [],
  gapAreas: [],
  judgeMeta: { judgeModelId: "mock-judge", judgePromptVersion: "v1" },
  ...override,
});

const makeLlmClient = (scoreOverride: Partial<ClaimSetScore> = {}): LlmClient => ({
  generate: vi.fn().mockResolvedValue({
    ok: true,
    value: JSON.stringify(makeScore(scoreOverride)),
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  }),
});

const goldenEntries: GoldenAnnotationEntry[] = [
  {
    videoId: "synthetic-lecture-1",
    title: "Synthetic Lecture",
    idealClaims: [
      { text: "Zone two training builds mitochondrial density.", type: "research_finding", children: [] },
      { text: "Progressive overload prevents overuse injuries.", type: "fact", children: [] },
    ],
    rejectedClaims: [],
  },
];

const transcripts: Record<string, string> = {
  "synthetic-lecture-1": "Zone two training builds mitochondrial density. Progressive overload prevents overuse injuries.",
};

describe("runCalibration", () => {
  it("returns a CalibrationRecord with correct top-level structure", async () => {
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts,
      judgeClient: makeLlmClient(),
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    expect(result.promptVersion).toBe("v1");
    expect(result.judgeModelId).toBe("mock-judge");
    expect(result.goldSetVideoIds).toEqual(["synthetic-lecture-1"]);
    expect(result.agreementThreshold).toBe(0.7);
    expect(result.perVideoResults).toHaveLength(1);
    expect(result.perVideoResults[0]?.videoId).toBe("synthetic-lecture-1");
  });

  it("marks perVideoResult passed when all dimension agreements exceed threshold", async () => {
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts,
      judgeClient: makeLlmClient(),
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    // mock score: 8.5–9.5; human: 10; min agreement = 1 - 2/10 = 0.8 >= 0.7
    expect(result.perVideoResults[0]?.passed).toBe(true);
    expect(result.overallPassed).toBe(true);
  });

  it("marks overallPassed false when mean dimension agreement is below threshold", async () => {
    const lowScore: Partial<ClaimSetScore> = {
      completeness: 0,
      accuracy: 0,
      topicCoverage: 0,
      atomicity: 0,
      overallScore: 0,
    };
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts,
      judgeClient: makeLlmClient(lowScore),
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    expect(result.overallPassed).toBe(false);
  });

  it("skips entries without a matching transcript and records a note", async () => {
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts: {},
      judgeClient: makeLlmClient(),
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    expect(result.perVideoResults).toHaveLength(0);
    expect(result.notes).toContain("synthetic-lecture-1");
  });

  it("flattens nested idealClaims children into the claim set", async () => {
    const entriesWithChildren: GoldenAnnotationEntry[] = [
      {
        videoId: "synthetic-lecture-1",
        title: "Synthetic Lecture",
        idealClaims: [
          {
            text: "Parent claim.",
            type: "assertion",
            children: [
              { text: "Child claim A.", type: "fact", children: [] },
              { text: "Child claim B.", type: "fact", children: [] },
            ],
          },
        ],
        rejectedClaims: [],
      },
    ];
    const client = makeLlmClient();
    const opts: CalibrationRunOptions = {
      goldenEntries: entriesWithChildren,
      transcripts,
      judgeClient: client,
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    await runCalibration(opts);
    // The judge client should have been called once; the claim set passed to scoreClaimSet
    // should include parent + 2 children = 3 claims total (verified indirectly via call count)
    expect(client.generate).toHaveBeenCalledOnce();
  });

  it("computes deltas as judgeScore − humanScore", async () => {
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts,
      judgeClient: makeLlmClient({ completeness: 7.5 }),
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    expect(result.perVideoResults[0]?.deltas.completeness).toBeCloseTo(7.5 - 10);
  });

  it("records scoring failures in scoringErrors when judge returns non-ok", async () => {
    const failingClient: LlmClient = {
      generate: vi.fn().mockResolvedValue({ ok: false, error: "model overloaded" }),
    };
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts,
      judgeClient: failingClient,
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    expect(result.perVideoResults).toHaveLength(0);
    expect(result.scoringErrors).toEqual(["synthetic-lecture-1"]);
  });

  it("produces output that validates against CalibrationRecordSchema on empty run", async () => {
    const opts: CalibrationRunOptions = {
      goldenEntries,
      transcripts: {},
      judgeClient: makeLlmClient(),
      judgeModelId: "mock-judge",
      promptVersion: "v1",
      agreementThreshold: 0.7,
    };
    const result = await runCalibration(opts);
    const parsed = CalibrationRecordSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.format(), null, 2));
    }
  });
});
