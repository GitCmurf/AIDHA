import type { ResolvedConfig } from "@aidha/config";
import type { LlmClient } from "../extract/index.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { ExtractorVariantId } from "./extractor-variants.js";
import type { EvalModel } from "./model-registry.js";
import type { Logger } from "../utils/logger.js";
import type { NarrowRunMode } from "./narrow-report-types.js";
import type { RequestRateLimiterRegistry } from "./request-rate-limiter.js";

export const DEFAULT_EMBEDDING_BUDGET_PER_RUN = 250;
export const DEFAULT_REFINED_SELF_IMPROVE_BUDGET_PER_RUN = 4;

export interface RunNarrowManualBaselineOptions {
  corpus: CorpusEntry[];
  transcriptDir: string;
  manualBaselineDir: string;
  outputDir: string;
  models: EvalModel[];
  variants: ExtractorVariantId[];
  judgeModelIds: string[];
  fallbackModelId: string;
  config: ResolvedConfig;
  clientFactory: (modelId: string) => LlmClient;
  rateLimiterRegistry?: RequestRateLimiterRegistry;
  maxConcurrency?: number;
  timeoutMs?: number;
  judgeMaxTokens?: number;
  runMode?: NarrowRunMode;
  shortlistPerVideo?: number;
  maxEmbeddingRequestsPerRun?: number;
  maxRefinedSelfImproveCellsPerRun?: number;
  judgeEnabled?: boolean;
  includeManualBaselines?: boolean;
  maxEmbeddingRequestsPerMinute?: number;
  /**
   * Explicit runtime environment snapshot.
   *
   * This lets callers forward dotenv-loaded values without mutating
   * process.env globally.
   */
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}
