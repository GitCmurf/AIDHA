import { join } from "node:path";
import type { LlmClient } from "../extract/index.js";
import { getModel, type EvalModel } from "./model-registry.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { MatrixCell } from "./matrix-runner.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { Logger } from "../utils/logger.js";
import type { SelfImproveHintInput } from "./teacher-analysis.js";
import { selfImproveHintKey } from "./teacher-analysis.js";
import { buildComparableCandidateId } from "./narrow-comparable-claim-set.js";
import { runHarnessExtractionOnly } from "./narrow-harness-extraction.js";
import { buildRefineStageInputSignature } from "./narrow-stage-signatures.js";
import {
  readNarrowStageArtifact,
  writeNarrowStageArtifact,
  type NarrowRefineStageArtifact,
  type NarrowShortlistTarget,
} from "./stage-artifact-store.js";
import type { NarrowRunMode } from "./narrow-report-types.js";

export interface RunNarrowRefineStageInput {
  extractionStageInputSignature: string;
  shortlistTargets: NarrowShortlistTarget[];
  initialHarnessCells: MatrixCell[];
  teacherAwareHints: Record<string, SelfImproveHintInput>;
}

export interface RunNarrowRefineStageResult {
  execution: "resumed" | "recomputed";
  refinedTargets: NarrowShortlistTarget[];
  refinedSelfImproveCells: MatrixCell[];
  finalHarnessCells: MatrixCell[];
}

export interface NarrowRefineStageContext {
  corpus: CorpusEntry[];
  models: EvalModel[];
  stage2Variants: ExtractorVariantId[];
  runMode: NarrowRunMode;
  outputDir: string;
  transcriptDir: string;
  clientFactory: (modelId: string) => LlmClient;
  maxConcurrency: number;
  timeoutMs: number;
  enablePromptRouting: boolean;
  remainingRefinedSelfImproveCells: () => number;
  budgetSkips: string[];
  logger: Logger;
}

export function createNarrowRefineStage(context: NarrowRefineStageContext): {
  run: (input: RunNarrowRefineStageInput) => Promise<RunNarrowRefineStageResult>;
} {
  const run = async (input: RunNarrowRefineStageInput): Promise<RunNarrowRefineStageResult> => {
    const refinedTargets = input.shortlistTargets.slice(0, context.remainingRefinedSelfImproveCells());
    if (input.shortlistTargets.length > refinedTargets.length) {
      context.budgetSkips.push(`refine-budget-exceeded:${input.shortlistTargets.length - refinedTargets.length}`);
      context.logger.warn(
        `[budget-skip] stage=refine skipped=${input.shortlistTargets.length - refinedTargets.length} remaining=${context.remainingRefinedSelfImproveCells()}`
      );
    }

    const inputSignature = buildRefineStageInputSignature({
      extractionStageInputSignature: input.extractionStageInputSignature,
      refinedTargets,
      teacherAwareHints: input.teacherAwareHints,
    });
    const cachedRefine = await readNarrowStageArtifact<NarrowRefineStageArtifact>(context.outputDir, "refine");
    if (cachedRefine?.inputSignature === inputSignature) {
      context.logger.info("[resume-from] stage=refine");
      return {
        execution: "resumed",
        refinedTargets: cachedRefine.refinedTargets,
        refinedSelfImproveCells: cachedRefine.refinedSelfImproveCells,
        finalHarnessCells: cachedRefine.finalHarnessCells,
      };
    }

    context.logger.info("[stage2-start] refine");
    const refinedSelfImproveCells: MatrixCell[] = [];
    if (context.stage2Variants.length > 0 && refinedTargets.length > 0) {
      for (const target of refinedTargets) {
        const targetCorpus = context.corpus.filter((video) => video.videoId === target.videoId);
        if (targetCorpus.length === 0) continue;
        const targetModel = context.models.find((model) => model.id === target.modelId) || getModel(target.modelId);
        if (!targetModel) continue;

        const hintKey = selfImproveHintKey(target.videoId, target.modelId, target.promptConfigId, target.chunkMode);
        const hint = input.teacherAwareHints[hintKey];
        const selfImproveHints = hint ? { [hintKey]: hint } : undefined;
        refinedSelfImproveCells.push(...await runHarnessExtractionOnly(
          targetCorpus,
          [targetModel],
          context.stage2Variants,
          target.promptConfigId,
          target.chunkMode,
          context.transcriptDir,
          context.clientFactory,
          context.maxConcurrency,
          context.timeoutMs,
          selfImproveHints,
          context.enablePromptRouting,
          target.promptPackId,
          "refined",
          context.outputDir,
          join(context.outputDir, ".cache", "extraction"),
          context.logger
        ));
      }
    }
    context.logger.info(`[stage2-done] refine targets=${refinedTargets.length}`);

    const shortlistedCandidateIds = new Set(input.shortlistTargets.map((target) => target.candidateId));
    const shortlistedHarnessCells = input.initialHarnessCells.filter((cell) => {
      const candidateId = buildComparableCandidateId(cell, "harness");
      return shortlistedCandidateIds.has(candidateId);
    });
    const finalHarnessCells = [...shortlistedHarnessCells, ...refinedSelfImproveCells];

    await writeNarrowStageArtifact<NarrowRefineStageArtifact>(context.outputDir, "refine", {
      stage: "refine",
      mode: context.runMode,
      createdAt: new Date().toISOString(),
      inputSignature,
      stage2Variants: context.stage2Variants,
      refinedTargets,
      refinedSelfImproveCells,
      finalHarnessCells,
    });

    return {
      execution: "recomputed",
      refinedTargets,
      refinedSelfImproveCells,
      finalHarnessCells,
    };
  };

  return { run };
}
