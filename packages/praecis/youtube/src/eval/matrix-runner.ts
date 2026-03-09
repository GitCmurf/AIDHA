import type { ClaimCandidate } from "../extract/types.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { ClaimSetScore } from "./scoring-rubric.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { EvalModel } from "./model-registry.js";

export interface VideoContext {
  videoId: string;
  title: string;
  channelName: string;
  description?: string;
  url?: string;
  durationMinutes?: number;
  topicDomain?: string;
}

export interface MatrixOptions {
  outputDir: string;
  resume: boolean;
  dryRun: boolean;
  variants: ExtractorVariantId[];
  judgeModels: string[];
  maxConcurrency: number;
  timeoutMs: number;
  extractionMaxTokens?: number;
  extractionMaxChunks?: number;
}

export type ScoreDimension =
  | "completeness"
  | "accuracy"
  | "topicCoverage"
  | "atomicity"
  | "overallScore";

export interface MatrixCell {
  videoId: string;
  modelId: string;
  extractorVariantId: ExtractorVariantId;
  claimSet: ClaimCandidate[];
  scores?: ClaimSetScore[];
  consensusScore?: {
    mean: ClaimSetScore;
    variance: Partial<Record<ScoreDimension, number>>;
  };
  error?: { message: string; code?: string };
}

export interface MatrixResult {
  cells: MatrixCell[];
  metadata: {
    startedAt: string;
    completedAt?: string;
    config: MatrixOptions;
    failedCellCount: number;
  };
}

export async function runEvaluationMatrix(
  corpus: CorpusEntry[],
  models: EvalModel[],
  options: MatrixOptions
): Promise<MatrixResult> {
  const startedAt = new Date().toISOString();
  const cells: MatrixCell[] = [];

  for (const video of corpus) {
    for (const model of models) {
      for (const variant of options.variants) {
        cells.push({
          videoId: video.videoId,
          modelId: model.id,
          extractorVariantId: variant,
          claimSet: [{ text: "Mock claim", excerptIds: [] }],
          scores: [{
            completeness: 8,
            accuracy: 9,
            topicCoverage: 7,
            atomicity: 10,
            overallScore: 8.5,
            reasoning: "Mock reasoning",
            missingClaims: [],
            hallucinations: [],
            redundancies: [],
            gapAreas: [],
            judgeMeta: { judgeModelId: options.judgeModels[0] || "mock-judge", judgePromptVersion: "v1" }
          }]
        });
      }
    }
  }

  return {
    cells,
    metadata: {
      startedAt,
      completedAt: new Date().toISOString(),
      config: options,
      failedCellCount: 0,
    },
  };
}
