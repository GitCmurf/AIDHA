import { join } from "node:path";
import type { LlmClient } from "../extract/index.js";
import type { ExtractionPromptPackId } from "../extract/prompt-routing.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { MatrixCell } from "./matrix-runner.js";
import { getModel, type EvalModel } from "./model-registry.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import { compareOptimizationPriority } from "./narrow-optimization-ranking.js";
import { needsFallbackForModel } from "./narrow-comparable-claim-set.js";
import { runHarnessExtractionOnly } from "./narrow-harness-extraction.js";
import {
  selectFastTriageEscalationPack,
  selectShortlistCandidatesForVideo,
} from "./narrow-mode-selection.js";
import type { NarrowEvalChunkMode } from "./narrow-eval-profiles.js";
import type { Pass1PromptConfigId } from "../extract/prompts/pass1-claim-mining-v2.js";
import type { Logger } from "../utils/logger.js";
import {
  readNarrowStageArtifact,
  writeNarrowStageArtifact,
  type NarrowShortlistStageArtifact,
  type NarrowShortlistTarget,
} from "./stage-artifact-store.js";
import type {
  NarrowComparisonVideoReport,
  NarrowRunMode,
} from "./narrow-report-types.js";

export interface RunNarrowShortlistStageResult {
  execution: "resumed" | "recomputed";
  initialHarnessCells: MatrixCell[];
  fallbackTriggeredFor: string[];
  fallbackCells: MatrixCell[];
  initialVideos: NarrowComparisonVideoReport[];
  shortlistTargets: NarrowShortlistTarget[];
  escalatedVideos: string[];
  escalationReasonsByVideo: Record<string, string[]>;
}

export interface NarrowShortlistStageContext {
  corpus: CorpusEntry[];
  models: EvalModel[];
  stage1Variants: ExtractorVariantId[];
  runMode: NarrowRunMode;
  outputDir: string;
  transcriptDir: string;
  fallbackModelId: string;
  chunkModes: NarrowEvalChunkMode[];
  promptConfigs: Pass1PromptConfigId[];
  shortlistPerVideo: number;
  adaptiveEscalation: boolean;
  enablePromptRouting: boolean;
  inputSignature: string;
  clientFactory: (modelId: string) => LlmClient;
  maxConcurrency: number;
  timeoutMs: number;
  buildVideoReports: (input: {
    harnessCells: MatrixCell[];
    fallbackCells: MatrixCell[];
    fallbackTriggeredFor: string[];
  }) => Promise<NarrowComparisonVideoReport[]>;
  includeManualBaselines: boolean;
  logger: Logger;
}

export function createNarrowShortlistStage(context: NarrowShortlistStageContext): {
  run: () => Promise<RunNarrowShortlistStageResult>;
} {
  const run = async (): Promise<RunNarrowShortlistStageResult> => {
    const cachedShortlist = await readNarrowStageArtifact<NarrowShortlistStageArtifact>(
      context.outputDir,
      "shortlist"
    );
    if (cachedShortlist?.inputSignature === context.inputSignature) {
      context.logger.info("[resume-from] stage=shortlist");
      return {
        execution: "resumed",
        initialHarnessCells: cachedShortlist.initialHarnessCells,
        fallbackTriggeredFor: cachedShortlist.fallbackTriggeredFor,
        fallbackCells: cachedShortlist.fallbackCells,
        initialVideos: cachedShortlist.videos,
        shortlistTargets: cachedShortlist.shortlistTargets,
        escalatedVideos: cachedShortlist.escalatedVideos ?? [],
        escalationReasonsByVideo: cachedShortlist.escalationReasonsByVideo ?? {},
      };
    }

    context.logger.info("[stage1-start] shortlist");
    const initialHarnessCells: MatrixCell[] = [];
    const fallbackTriggeredFor: string[] = [];
    const fallbackCells: MatrixCell[] = [];
    let escalatedVideos: string[] = [];
    const escalationReasonsByVideo: Record<string, string[]> = {};

    for (const promptConfigId of context.promptConfigs) {
      for (const chunkMode of context.chunkModes) {
        initialHarnessCells.push(...await runHarnessExtractionOnly(
          context.corpus,
          context.models,
          context.stage1Variants,
          promptConfigId,
          chunkMode,
          context.transcriptDir,
          context.clientFactory,
          context.maxConcurrency,
          context.timeoutMs,
          undefined,
          context.enablePromptRouting,
          undefined,
          undefined,
          context.outputDir,
          join(context.outputDir, ".cache", "extraction"),
          context.logger
        ));
      }
    }

    const fallbackModel = context.models.find((model) => model.id === context.fallbackModelId)
      || getModel(context.fallbackModelId);
    if (fallbackModel) {
      const fallbackTargets = context.models
        .filter((model) => model.id !== context.fallbackModelId)
        .filter((model) => needsFallbackForModel(initialHarnessCells, model.id));

      if (fallbackTargets.length > 0) {
        fallbackTriggeredFor.push(...fallbackTargets.map((model) => model.id));
        for (const promptConfigId of context.promptConfigs) {
          for (const chunkMode of context.chunkModes) {
            fallbackCells.push(...await runHarnessExtractionOnly(
              context.corpus,
              [fallbackModel],
              context.stage1Variants,
              promptConfigId,
              chunkMode,
              context.transcriptDir,
              context.clientFactory,
              context.maxConcurrency,
              context.timeoutMs,
              undefined,
              context.enablePromptRouting,
              undefined,
              undefined,
              context.outputDir,
              join(context.outputDir, ".cache", "extraction"),
              context.logger
            ));
          }
        }
      }
    }

    let initialVideos = await context.buildVideoReports({
      harnessCells: initialHarnessCells,
      fallbackCells,
      fallbackTriggeredFor,
    });
    if (context.adaptiveEscalation) {
      for (const video of initialVideos) {
        const topHarnessCandidate = video.candidateReports
          .filter((candidate) => candidate.sourceKind === "harness")
          .slice()
          .sort(compareOptimizationPriority)[0];
        if (!topHarnessCandidate?.promptConfigId) continue;
        const promptPackId = selectFastTriageEscalationPack({
          topicDomain: context.corpus.find((entry) => entry.videoId === video.videoId)?.topicDomain,
          semanticCoverage: topHarnessCandidate.semanticCoverage,
          diagnostics: topHarnessCandidate.diagnostics,
        });
        if (!promptPackId) continue;

        const targetCorpus = context.corpus.filter((entry) => entry.videoId === video.videoId);
        if (targetCorpus.length === 0) continue;
        const reason = topHarnessCandidate.diagnostics?.retryReason
          ?? (topHarnessCandidate.semanticCoverage.rootRatio === 0 ? "missing-root-claim" : "low-semantic-coverage");
        escalationReasonsByVideo[video.videoId] = [...new Set([
          ...(escalationReasonsByVideo[video.videoId] ?? []),
          reason,
          `prompt-pack:${promptPackId}`,
        ])];
        escalatedVideos.push(video.videoId);

        initialHarnessCells.push(...await runHarnessExtractionOnly(
          targetCorpus,
          context.models,
          context.stage1Variants,
          topHarnessCandidate.promptConfigId,
          "small-request",
          context.transcriptDir,
          context.clientFactory,
          context.maxConcurrency,
          context.timeoutMs,
          undefined,
          false,
          promptPackId,
          undefined,
          context.outputDir,
          join(context.outputDir, ".cache", "extraction"),
          context.logger
        ));
      }
      if (escalatedVideos.length > 0) {
        escalatedVideos = [...new Set(escalatedVideos)];
        initialVideos = await context.buildVideoReports({
          harnessCells: initialHarnessCells,
          fallbackCells,
          fallbackTriggeredFor,
        });
      }
    }

    const shortlistTargets = initialVideos.flatMap((video) =>
      selectShortlistCandidatesForVideo(
        video,
        context.shortlistPerVideo,
        context.adaptiveEscalation && escalatedVideos.includes(video.videoId)
      )
        .map((candidate) => ({
          videoId: video.videoId,
          modelId: candidate.modelId!,
          promptConfigId: candidate.promptConfigId!,
          chunkMode: candidate.chunkMode!,
          candidateId: candidate.candidateId,
          promptPackId: candidate.diagnostics?.promptPackId as ExtractionPromptPackId | undefined,
        }))
    );

    await writeNarrowStageArtifact<NarrowShortlistStageArtifact>(context.outputDir, "shortlist", {
      stage: "shortlist",
      mode: context.runMode,
      createdAt: new Date().toISOString(),
      inputSignature: context.inputSignature,
      chunkModes: context.chunkModes,
      promptConfigs: context.promptConfigs,
      stage1Variants: context.stage1Variants,
      initialHarnessCells,
      fallbackTriggeredFor,
      fallbackCells,
      videos: initialVideos,
      shortlistTargets,
      escalatedVideos,
      escalationReasonsByVideo,
    });
    context.logger.info(`[stage1-done] shortlist targets=${shortlistTargets.length}`);

    return {
      execution: "recomputed",
      initialHarnessCells,
      fallbackTriggeredFor,
      fallbackCells,
      initialVideos,
      shortlistTargets,
      escalatedVideos,
      escalationReasonsByVideo,
    };
  };

  return { run };
}
