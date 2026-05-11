import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MatrixCell } from "../../src/eval/matrix-runner.js";
import { buildRefineStageInputSignature } from "../../src/eval/narrow-stage-signatures.js";
import { createNarrowRefineStage } from "../../src/eval/narrow-refine-stage.js";
import { writeNarrowStageArtifact, type NarrowRefineStageArtifact } from "../../src/eval/stage-artifact-store.js";
import type { Logger } from "../../src/utils/logger.js";

function cell(overrides: Partial<MatrixCell>): MatrixCell {
  return {
    videoId: "video-1",
    modelId: "model-1",
    extractorVariantId: "raw",
    promptConfigId: "baseline",
    chunkMode: "large-request",
    claimSet: [{ text: "Claim text.", type: "fact", source: "llm" }],
    ...overrides,
  } as MatrixCell;
}

function testLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("narrow refine stage", () => {
  it("recomputes without live clients and composes shortlisted harness cells", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-refine-stage-"));
    const budgetSkips: string[] = [];
    const logger = testLogger();
    const initialHarnessCells = [
      cell({ modelId: "model-1" }),
      cell({ modelId: "model-2" }),
    ];

    const result = await createNarrowRefineStage({
      corpus: [],
      models: [],
      stage2Variants: [],
      runMode: "fast-triage",
      outputDir,
      transcriptDir: "transcripts",
      clientFactory: () => {
        throw new Error("client should not be used");
      },
      maxConcurrency: 1,
      timeoutMs: 1000,
      enablePromptRouting: false,
      remainingRefinedSelfImproveCells: () => 1,
      budgetSkips,
      logger,
    }).run({
      extractionStageInputSignature: "extract-v1",
      shortlistTargets: [
        {
          videoId: "video-1",
          modelId: "model-1",
          promptConfigId: "baseline",
          chunkMode: "large-request",
          candidateId: "harness/model-1/raw/baseline/large-request",
        },
        {
          videoId: "video-1",
          modelId: "model-2",
          promptConfigId: "baseline",
          chunkMode: "large-request",
          candidateId: "harness/model-2/raw/baseline/large-request",
        },
      ],
      initialHarnessCells,
      teacherAwareHints: {},
    });

    expect(result.execution).toBe("recomputed");
    expect(result.refinedTargets).toHaveLength(1);
    expect(result.refinedSelfImproveCells).toEqual([]);
    expect(result.finalHarnessCells.map((candidate) => candidate.modelId)).toEqual(["model-1", "model-2"]);
    expect(budgetSkips).toEqual(["refine-budget-exceeded:1"]);
    expect(logger.warn).toHaveBeenCalledWith("[budget-skip] stage=refine skipped=1 remaining=1");

    const artifact = JSON.parse(await readFile(join(outputDir, "stages", "refine.json"), "utf-8"));
    expect(artifact.finalHarnessCells).toHaveLength(2);
    expect(artifact.refinedTargets).toHaveLength(1);
  });

  it("resumes matching refine artifacts without recomputing", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "narrow-refine-stage-resume-"));
    const refinedTargets = [{
      videoId: "video-1",
      modelId: "model-1",
      promptConfigId: "baseline" as const,
      chunkMode: "large-request" as const,
      candidateId: "harness/model-1/raw/baseline/large-request",
    }];
    const inputSignature = buildRefineStageInputSignature({
      extractionStageInputSignature: "extract-v1",
      refinedTargets,
      teacherAwareHints: {},
    });
    const cachedFinalCell = cell({ modelId: "cached-model" });
    await writeNarrowStageArtifact<NarrowRefineStageArtifact>(outputDir, "refine", {
      stage: "refine",
      mode: "fast-triage",
      createdAt: "2026-05-11T00:00:00.000Z",
      inputSignature,
      stage2Variants: [],
      refinedTargets,
      refinedSelfImproveCells: [],
      finalHarnessCells: [cachedFinalCell],
    });

    const logger = testLogger();
    const result = await createNarrowRefineStage({
      corpus: [],
      models: [],
      stage2Variants: [],
      runMode: "fast-triage",
      outputDir,
      transcriptDir: "transcripts",
      clientFactory: () => {
        throw new Error("client should not be used");
      },
      maxConcurrency: 1,
      timeoutMs: 1000,
      enablePromptRouting: false,
      remainingRefinedSelfImproveCells: () => 1,
      budgetSkips: [],
      logger,
    }).run({
      extractionStageInputSignature: "extract-v1",
      shortlistTargets: refinedTargets,
      initialHarnessCells: [cell({ modelId: "fresh-model" })],
      teacherAwareHints: {},
    });

    expect(result.execution).toBe("resumed");
    expect(result.finalHarnessCells).toEqual([cachedFinalCell]);
    expect(logger.info).toHaveBeenCalledWith("[resume-from] stage=refine");
  });
});
