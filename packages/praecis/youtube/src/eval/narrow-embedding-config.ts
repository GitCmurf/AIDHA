import type { ResolvedConfig } from "@aidha/config";
import { isOpenAiBaseUrl } from "../utils/urls.js";
import type { GeminiEmbeddingClientConfig } from "./gemini-embedding-client.js";

export const DEFAULT_GOOGLE_EMBEDDING_MODEL = "gemini-embedding-001";

export interface GoogleEmbeddingConfig {
  apiKey?: string;
  baseUrl: string;
  model?: string;
  batchSize?: number;
  taskType?: GeminiEmbeddingClientConfig["taskType"];
  outputDimensionality?: number;
}

export function getGoogleEmbeddingConfig(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv = process.env
): GoogleEmbeddingConfig {
  const llm = config.llm;
  const isGeminiModel = llm.model?.toLowerCase().startsWith("gemini-");
  const isOpenAiDefault = isOpenAiBaseUrl(llm.baseUrl);

  return {
    apiKey:
      env["GOOGLE_AISTUDIO_API_KEY"] ||
      env["GEMINI_API_KEY"] ||
      env["GOOGLE_API_KEY"] ||
      env["AIDHA_GOOGLE_API_KEY"] ||
      ((isGeminiModel || llm.apiKey?.startsWith("AIza")) ? llm.apiKey : ""),
    baseUrl:
      env["GOOGLE_EMBEDDING_BASE_URL"] ||
      (isGeminiModel
        ? (isOpenAiDefault
          ? "https://generativelanguage.googleapis.com/v1beta"
          : llm.baseUrl.replace(/\/openai\/?$/, ""))
        : "https://generativelanguage.googleapis.com/v1beta"),
    model:
      env["GOOGLE_EMBEDDING_MODEL"] ||
      env["AIDHA_GOOGLE_EMBEDDING_MODEL"] ||
      env["AIDHA_EVAL_EMBEDDING_MODEL"] ||
      DEFAULT_GOOGLE_EMBEDDING_MODEL,
    batchSize: llm.embeddingBatchSize,
    taskType: (
      env["GOOGLE_EMBEDDING_TASK_TYPE"] ||
      llm.embeddingTaskType ||
      "SEMANTIC_SIMILARITY"
    ) as GeminiEmbeddingClientConfig["taskType"],
    outputDimensionality:
      Number(env["GOOGLE_EMBEDDING_OUTPUT_DIMENSIONALITY"]) ||
      llm.embeddingOutputDimensionality ||
      768,
  };
}
