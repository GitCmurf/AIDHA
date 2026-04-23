import type { ResolvedConfig } from "@aidha/config";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeJsonAtomic, writeFileAtomic } from "./utils/io.js";
import { fileURLToPath } from "node:url";
import { runEvaluationMatrix, type MatrixOptions, type MatrixResult } from "./eval/matrix-runner.js";
import { getModel, MODEL_REGISTRY, type EvalModel } from "./eval/model-registry.js";
import { aggregateMatrixResults, type MatrixReport } from "./eval/matrix-aggregator.js";
import { renderMatrixReport } from "./eval/report-markdown.js";
import { exportMatrixJson } from "./eval/report-json.js";
import { buildReportFileSet } from "./eval/report-files.js";
import { EXTRACTOR_VARIANTS, isValidVariant, type ExtractorVariantId } from "./eval/extractor-variants.js";
import { createGeminiClientFromConfig, createLlmClientFromConfig, type LlmCompletionRequest } from "./extract/llm-client.js";
import { optionString, optionBool, optionNumber, type CliOptions } from "./cli.js";
import { CorpusSchema, type CorpusEntry } from "./eval/corpus-schema.js";
import {
  NarrowCorpusSchema,
  runNarrowManualBaselineComparison,
  writeNarrowComparisonReport,
} from "./eval/narrow-manual-baseline.js";
import { wrapClientWithRateLimit } from "./eval/request-rate-limiter.js";
import { getNarrowEvalModelProfile } from "./eval/narrow-eval-profiles.js";
import { validateSafeId } from "./utils/ids.js";
import { sanitizeFilename } from "./utils/ids.js";

// ─────────────────────────────────────────────────────────────────────────────
// Provider Configuration
// ─────────────────────────────────────────────────────────────────────────────

const getOpenAiConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string, isProviderProfile?: boolean) => {
  const envKey = process.env["OPENAI_API_KEY"] || process.env["AIDHA_OPENAI_API_KEY"];
  const effectiveBaseUrl = baseUrl || (isProviderProfile ? baseConfigBaseUrl : "") || "https://api.openai.com/v1";
  if (envKey) return { apiKey: envKey, baseUrl: effectiveBaseUrl };

  return {
    apiKey: isProviderProfile ? apiKey : "",
    baseUrl: effectiveBaseUrl
  };
};

const getGoogleAiStudioConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string, isProviderProfile?: boolean) => {
  const envKey =
    process.env["GOOGLE_AISTUDIO_API_KEY"] ||
    process.env["GEMINI_API_KEY"] ||
    process.env["GOOGLE_API_KEY"] ||
    process.env["AIDHA_GOOGLE_API_KEY"];

  const effectiveBaseUrl = baseUrl || (isProviderProfile ? baseConfigBaseUrl : "");
  const isOpenAiDefault = effectiveBaseUrl?.includes("openai.com");
  const finalBaseUrl = isOpenAiDefault
        ? "https://generativelanguage.googleapis.com/v1beta"
        : (effectiveBaseUrl ? effectiveBaseUrl.replace(/\/openai\/?$/, "") : "https://generativelanguage.googleapis.com/v1beta");

  if (envKey) return { apiKey: envKey, baseUrl: finalBaseUrl };

  return {
    apiKey: isProviderProfile ? apiKey : "",
    baseUrl: finalBaseUrl
  };
};

const getZaiConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string, isProviderProfile?: boolean) => {
  const envKey = process.env["ZAI_API_KEY"] || process.env["AIDHA_ZAI_API_KEY"];
  const effectiveBaseUrl = baseUrl || (isProviderProfile ? baseConfigBaseUrl : "") || "https://api.zai.ai/v1";
  if (envKey) return { apiKey: envKey, baseUrl: effectiveBaseUrl };

  return {
    apiKey: isProviderProfile ? apiKey : "",
    baseUrl: effectiveBaseUrl
  };
};

const getXiaomiConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string, isProviderProfile?: boolean) => {
  const envKey = process.env["XIAOMI_API_KEY"] || process.env["AIDHA_XIAOMI_API_KEY"];
  const effectiveBaseUrl = baseUrl || (isProviderProfile ? baseConfigBaseUrl : "") || "https://api.xiaomi.com/v1";
  if (envKey) return { apiKey: envKey, baseUrl: effectiveBaseUrl };

  return {
    apiKey: isProviderProfile ? apiKey : "",
    baseUrl: effectiveBaseUrl
  };
};

// Reserved for future use - OpenRouter support when ModelProvider is expanded
const getOpenRouterConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string, isProviderProfile?: boolean) => {
  const envKey = process.env["OPENROUTER_API_KEY"] || process.env["AIDHA_OPENROUTER_API_KEY"];
  if (envKey) {
    return { apiKey: envKey, baseUrl: baseUrl || baseConfigBaseUrl || "https://openrouter.ai/api/v1" };
  }

  // Only fall back to profile apiKey if it explicitly looks like an OpenRouter key or profile matches
  const looksLikeOpenRouter = apiKey.startsWith("sk-or-v1-") || baseConfigBaseUrl?.includes("openrouter.ai");
  const useProfile = isProviderProfile || looksLikeOpenRouter;

  return {
    apiKey: useProfile ? apiKey : "",
    baseUrl: baseUrl || (useProfile ? baseConfigBaseUrl : "") || "https://openrouter.ai/api/v1"
  };
};

type ProviderConfigGetter = (
  apiKey: string,
  baseUrl?: string,
  baseConfigBaseUrl?: string,
  isProviderProfile?: boolean
) => { apiKey: string; baseUrl: string } | null;

// Only these four providers are supported (matching ModelProvider in model-registry.ts)
// Provider-specific runtime wiring. Some providers use the OpenAI-compatible client;
// Gemini uses its native generateContent API for full feature access.
const providerConfigGetters: Record<string, ProviderConfigGetter> = {
  openai: getOpenAiConfig,
  "google-aistudio": getGoogleAiStudioConfig,
  zai: getZaiConfig,
  xiaomi: getXiaomiConfig,
  openrouter: getOpenRouterConfig,
};

const SUPPORTED_EVAL_PROVIDERS = new Set(["openai", "google-aistudio", "zai", "xiaomi", "openrouter"]);

// ─────────────────────────────────────────────────────────────────────────────
// CLI Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exit codes for the CLI.
 * 0 = Success
 * 1 = Error (execution failed)
 * 2 = Invalid options
 */
const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_INVALID_OPTIONS = 2;

const CLI_EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CLI_EVAL_DIR, "../../../..");

function resolveRepoRelativePath(pathValue: string): string {
  return resolve(REPO_ROOT, pathValue);
}

/**
 * Parses a comma-separated list string into an array of trimmed, non-empty values.
 * Used for parsing --variants, --judge-models, and similar options.
 */
function parseCsvList(csvStr: string): string[] {
  return csvStr.split(",").map((s: string) => s.trim()).filter(Boolean);
}

/**
 * Validates that a list is non-empty and returns an appropriate error code if not.
 * @param items - The list to validate
 * @param optionName - The CLI option name for error messages
 * @returns EXIT_SUCCESS if valid, EXIT_INVALID_OPTIONS if invalid
 */
function validateNonEmptyList(items: string[], optionName: string): number {
  if (items.length === 0) {
    // skipcq: JS-0002
    console.error(`Error: ${optionName} must contain at least one valid value.`);
    return EXIT_INVALID_OPTIONS;
  }
  return EXIT_SUCCESS;
}

/**
 * Validates that a number is positive (>= 1).
 * @param value - The value to validate
 * @param optionName - The CLI option name for error messages
 * @returns EXIT_SUCCESS if valid, EXIT_INVALID_OPTIONS if invalid
 */
function validatePositiveNumber(value: number | undefined, optionName: string): number {
  if (value !== undefined && value < 1) {
    // skipcq: JS-0002
    console.error(`Error: ${optionName} must be a positive number.`);
    return EXIT_INVALID_OPTIONS;
  }
  return EXIT_SUCCESS;
}

/**
 * Resolves the cache directory path for a given run ID.
 * If a run ID is provided, returns a run-specific cache directory.
 * Otherwise, returns the default extraction cache directory.
 *
 * @param runId - The optional run ID
 * @returns The resolved cache directory path
 */
function resolveCacheDir(runId: string): string {
  return runId ? join(".cache/extraction", runId) : ".cache/extraction";
}

const resolveProviderConfig = (provider: string, apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string, isProviderProfile?: boolean) => {
  const getter = providerConfigGetters[provider];
  return getter ? getter(apiKey, baseUrl, baseConfigBaseUrl, isProviderProfile) : null;
};

/**
 * Creates an LLM client configured for a specific model by resolving the appropriate
 * provider configuration (API key, base URL) based on the model's provider.
 *
 * @param modelId - The model ID from the evaluation registry
 * @param baseConfig - Base LLM configuration containing API keys and default settings
 * @returns Configured LLM client for the given model
 * @throws Error if the provider is unsupported or baseUrl cannot be resolved
 */
export const createProviderAwareClient = (
  modelId: string,
  baseConfig: ResolvedConfig["llm"],
  overrides?: Partial<Pick<ResolvedConfig["llm"], "timeoutMs" | "apiKey" | "baseUrl">> & { maxRequestsPerMinute?: number }
) => {
  const model = getModel(modelId);
  if (!model) {
    throw new Error(`Model '${modelId}' not found in the evaluation registry.`);
  }
  const provider = model.provider;

  if (!SUPPORTED_EVAL_PROVIDERS.has(provider)) {
    throw new Error(
      `Provider '${provider}' for model ${modelId} is not supported by the evaluation runtime.`
    );
  }

  const isGoogle = provider === "google-aistudio";
  const isOpenAi = provider === "openai";
  const modelPrefix = isGoogle ? "gemini-" : provider;

  const isMatch = baseConfig.model?.toLowerCase().startsWith(modelPrefix);
  const baseUrlMatch =
    (isGoogle && baseConfig.baseUrl?.includes("generativelanguage.googleapis.com")) ||
    (provider === "zai" && baseConfig.baseUrl?.includes("api.zai.ai")) ||
    (provider === "xiaomi" && baseConfig.baseUrl?.includes("api.xiaomi.com"));

  // OpenAI profiles always inherit permissive credentials (to support custom proxies).
  // Other providers inherit if the profile model matches the provider or baseUrl matches.
  const isProviderProfile = isOpenAi || isMatch || baseUrlMatch;
  const resolved = resolveProviderConfig(provider, baseConfig.apiKey, model.baseUrl, baseConfig.baseUrl, isProviderProfile);
  if (!resolved) {
    throw new Error(`Unsupported provider '${provider}' for model ${modelId}. Cannot resolve baseUrl.`);
  }

  if (!resolved.baseUrl) {
    throw new Error(`Failed to resolve baseUrl for model ${modelId} (provider: ${provider})`);
  }

  const clientFactory = provider === "google-aistudio"
    ? createGeminiClientFromConfig
    : createLlmClientFromConfig;

  const clientResult = clientFactory({
    ...baseConfig,
    model: modelId,
    apiKey: overrides?.apiKey ?? resolved.apiKey,
    baseUrl: overrides?.baseUrl ?? resolved.baseUrl,
    timeoutMs: overrides?.timeoutMs ?? baseConfig.timeoutMs,
  });

  if (!clientResult.ok) throw clientResult.error;
  const remappedClient = !model.apiModelId || model.apiModelId === modelId
    ? clientResult.value
    : {
    generate: (request: LlmCompletionRequest) => clientResult.value.generate({
      ...request,
      model: request.model === modelId ? model.apiModelId! : request.model,
    }),
  };

  return overrides?.maxRequestsPerMinute
    ? wrapClientWithRateLimit(remappedClient, modelId, overrides.maxRequestsPerMinute)
    : remappedClient;
};

export const resolveProviderConnection = (modelId: string, baseConfig: ResolvedConfig["llm"]) => {
  const model = getModel(modelId);
  if (!model) {
    throw new Error(`Model '${modelId}' not found in the evaluation registry.`);
  }
  const isGoogle = model.provider === "google-aistudio";
  const isOpenAi = model.provider === "openai";
  const modelPrefix = isGoogle ? "gemini-" : model.provider;

  const isMatch = baseConfig.model?.toLowerCase().startsWith(modelPrefix);
  const baseUrlMatch =
    (isGoogle && baseConfig.baseUrl?.includes("generativelanguage.googleapis.com")) ||
    (model.provider === "zai" && baseConfig.baseUrl?.includes("api.zai.ai")) ||
    (model.provider === "xiaomi" && baseConfig.baseUrl?.includes("api.xiaomi.com"));

  const isProviderProfile = isOpenAi || isMatch || baseUrlMatch;
  const resolved = resolveProviderConfig(model.provider, baseConfig.apiKey, model.baseUrl, baseConfig.baseUrl, isProviderProfile);
  if (!resolved) {
    throw new Error(`Unsupported provider '${model.provider}' for model ${modelId}. Cannot resolve baseUrl.`);
  }
  return {
    model,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
  };
};

const loadCorpusData = (corpusPath: string) => {
  try {
    const raw = JSON.parse(readFileSync(corpusPath, "utf-8"));
    const parsed = CorpusSchema.safeParse(raw);
    if (!parsed.success) {
      // skipcq: JS-0002
      console.error("Corpus file validation failed:", JSON.stringify(parsed.error.format(), null, 2));
      return { ok: false, error: 1 };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    // skipcq: JS-0002
    console.error(`Failed to read or validate corpus file at ${corpusPath}:`, err);
    return { ok: false, error: 1 };
  }
};

const loadNarrowCorpusData = (corpusPath: string) => {
  try {
    const raw = JSON.parse(readFileSync(corpusPath, "utf-8"));
    const parsed = NarrowCorpusSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Narrow corpus file validation failed:", JSON.stringify(parsed.error.format(), null, 2));
      return { ok: false, error: 1 };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    console.error(`Failed to read or validate narrow corpus file at ${corpusPath}:`, err);
    return { ok: false, error: 1 };
  }
};

const resolveModelIds = (modelsStr: string, tier: string): string[] | number => {
  if (modelsStr) {
    const ids = parseCsvList(modelsStr);
    if (ids.length > 0) return ids;
  }
  if (tier) {
    const ids = MODEL_REGISTRY
      .filter(m => m.tier === tier)
      .filter(m => m.availability !== "experimental")
      .filter(m => SUPPORTED_EVAL_PROVIDERS.has(m.provider))
      .map(m => m.id);
    if (ids.length === 0) {
      // skipcq: JS-0002
      console.error(`No verified supported models found for tier: ${tier}. Use explicit --models with a supported provider.`);
      return 1;
    }
    return ids;
  }
  return ["gpt-4o-mini"];
};

const getModelsFromIdsOrTier = (modelsStr: string, tier: string): EvalModel[] | number => {
  const modelIds = resolveModelIds(modelsStr, tier);
  if (typeof modelIds === "number") return modelIds;

  try {
    return modelIds.map(id => {
      const model = getModel(id);
      if (!model) throw new Error(`Model ${id} not found in registry`);
      return model;
    });
  } catch (err) {
    // skipcq: JS-0002
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
};

const writeCellArtifacts = async (cells: MatrixResult["cells"], outputDir: string) => {
  const cellsDir = join(outputDir, "cells");
  mkdirSync(cellsDir, { recursive: true });
  await Promise.all(
    cells.map((cell) => {
      const safeVideoId = sanitizeFilename(cell.videoId);
      const safeModelId = sanitizeFilename(cell.modelId);
      const safeVariantId = sanitizeFilename(cell.extractorVariantId);
      const cellFileName = `${safeVideoId}-${safeModelId}-${safeVariantId}.json`;
      const cellPath = join(cellsDir, cellFileName);
      return writeJsonAtomic(cellPath, cell);
    })
  );
  // skipcq: JS-0002
  console.log(`Wrote ${cells.length} cell artifacts to ${cellsDir}`);
};

const writeReports = async (report: MatrixReport, outputDir: string, format: string, stub: string) => {
  mkdirSync(outputDir, { recursive: true });
  const files = buildReportFileSet(outputDir, stub);
  const jsonContent = exportMatrixJson(report, { pretty: true });
  const mdContent = renderMatrixReport(report);

  // Always refresh both convenience aliases regardless of chosen format
  await writeFileAtomic(files.latestJsonPath, jsonContent);
  await writeFileAtomic(files.latestMdPath, mdContent);

  if (format === "both" || format === "json") {
    await writeFileAtomic(files.jsonPath, jsonContent);
    // skipcq: JS-0002
    console.log(`Wrote JSON report to ${files.jsonPath}`);
  }

  if (format === "both" || format === "md") {
    await writeFileAtomic(files.mdPath, mdContent);
    // skipcq: JS-0002
    console.log(`Wrote Markdown report to ${files.mdPath}`);
  }

  await writeCellArtifacts(report.cells, outputDir);
  return files;
};

interface PrintPlanArgs {
  runId: string;
  corpusPath: string;
  models: EvalModel[];
  tier: string;
  judgeModels: string[];
  variantIds: string[];
  finalOutputDir: string;
  runCacheDir: string;
  format: string;
  resume: boolean;
  maxConcurrency: number;
  extractionMaxTokens?: number;
  extractionMaxChunks?: number;
  judgeMaxTokens?: number;
  timeoutMs: number;
}

const printPlan = (planArgs: PrintPlanArgs) => {
  // skipcq: JS-0002
  console.log(`Evaluation Matrix Plan:
Run ID: ${planArgs.runId || 'default'}
Corpus: ${planArgs.corpusPath}
Models: ${planArgs.models.map(m => m.id).join(", ")}
Tier: ${planArgs.tier || 'all'}
Judge Models: ${planArgs.judgeModels.join(", ")}
Variants: ${planArgs.variantIds.join(", ")}
Output Dir: ${planArgs.finalOutputDir}
Cache Dir: ${planArgs.runCacheDir}
Format: ${planArgs.format}
Resume: ${planArgs.resume}
Max Concurrency: ${planArgs.maxConcurrency}
Extraction Max Tokens: ${planArgs.extractionMaxTokens || 'default'}
Extraction Max Chunks: ${planArgs.extractionMaxChunks || 'default'}
Judge Max Tokens: ${planArgs.judgeMaxTokens}
Timeout: ${planArgs.timeoutMs}ms
`);
};

interface EvalRunOptions {
  dryRun: boolean;
  runId: string;
  corpusPath: string;
  transcriptDir: string;
  modelsStr: string;
  tier: string;
  judgeModelsStr: string;
  variantsStr: string;
  outputDir: string;
  format: string;
  resume: boolean;
  maxConcurrency: number;
  extractionMaxTokens?: number;
  extractionMaxChunks?: number;
  judgeMaxTokens: number;
  timeoutMs: number;
}

const parseRunOptions = (cleanOptions: CliOptions): EvalRunOptions => {
  const dryRun = optionBool(cleanOptions, "dry-run");
  const runId = optionString(cleanOptions, "run-id", "");
  const corpusPath = optionString(cleanOptions, "corpus", "");
  const transcriptDir = optionString(cleanOptions, "transcript-dir", "out/eval-matrix/transcripts");
  const modelsStr = optionString(cleanOptions, "models", "");
  const tier = optionString(cleanOptions, "tier", "");
  const judgeModelsStr = optionString(cleanOptions, "judge-models", "gpt-4o-mini");
  const variantsStr = optionString(cleanOptions, "variants", "raw,editorial-pass-v1");
  const outputDir = optionString(cleanOptions, "output-dir", "");
  const format = optionString(cleanOptions, "format", "both");
  const resume = optionBool(cleanOptions, "resume");
  const maxConcurrency = optionNumber(cleanOptions, "max-concurrency", 1);
  const extractionMaxTokensRaw = optionNumber(cleanOptions, "extraction-max-tokens", 0);
  const extractionMaxTokens = extractionMaxTokensRaw === 0 ? undefined : extractionMaxTokensRaw;
  const extractionMaxChunksRaw = optionNumber(cleanOptions, "extraction-max-chunks", 0);
  const extractionMaxChunks = extractionMaxChunksRaw === 0 ? undefined : extractionMaxChunksRaw;
  const judgeMaxTokens = optionNumber(cleanOptions, "judge-max-tokens", 4000);
  const timeoutMs = optionNumber(cleanOptions, "timeout-ms", 60000);

  return {
    dryRun, runId, corpusPath, transcriptDir, modelsStr, tier, judgeModelsStr,
    variantsStr, outputDir, format, resume, maxConcurrency, extractionMaxTokens,
    extractionMaxChunks, judgeMaxTokens, timeoutMs
  };
};

const handleClearAll = (cleanOptions: CliOptions, cacheDir: string): number => {
  if (optionBool(cleanOptions, "yes")) {
    // skipcq: JS-0002
    console.log(`Clearing ALL evaluation cache in: ${cacheDir}`);
    rmSync(cacheDir, { recursive: true, force: true });
    return 0;
  }
  // skipcq: JS-0002
  console.error("Error: --clear-all requires --yes to confirm you want to delete all cached extractions and scores.");
  return EXIT_INVALID_OPTIONS;
};

const handleInvalidateRun = (invalidateRun: string, cacheDir: string): number => {
  if (!/^[a-zA-Z0-9_-]+$/.test(invalidateRun)) {
    // skipcq: JS-0002
    console.error("Error: --invalidate-run must contain only alphanumeric characters, hyphens, and underscores.");
    return EXIT_INVALID_OPTIONS;
  }
  const runDir = join(cacheDir, invalidateRun);
  if (existsSync(runDir)) {
    // skipcq: JS-0002
    console.log(`Invalidating cache for run: ${invalidateRun}`);
    rmSync(runDir, { recursive: true, force: true });
  } else {
    // skipcq: JS-0002
    console.warn(`Cache for run '${invalidateRun}' not found.`);
  }
  return 0;
};

const invalidateCache = (cleanOptions: CliOptions): number | undefined => {
  const invalidateRun = optionString(cleanOptions, "invalidate-run", "");
  const clearAll = optionBool(cleanOptions, "clear-all");

  if (!invalidateRun && !clearAll) return undefined;

  const baseCacheDir = ".cache/extraction";

  if (clearAll) {
    if (!existsSync(baseCacheDir)) {
      // skipcq: JS-0002
      console.log("No cache directory found to invalidate.");
      return 0;
    }
    return handleClearAll(cleanOptions, baseCacheDir);
  }

  return handleInvalidateRun(invalidateRun, baseCacheDir);
};

const calculateTotalCosts = (cells: MatrixResult["cells"]) => {
  let extractionUsd = 0;
  let judgeUsd = 0;
  for (const cell of cells) {
    if (cell.costEstimate) {
      extractionUsd += cell.costEstimate.extractionUsd;
      judgeUsd += cell.costEstimate.judgeUsd;
    }
  }
  return { extractionUsd, judgeUsd };
};

const handleCostReporting = (matrixResult: MatrixResult, isDryRun: boolean) => {
  const { extractionUsd: totalExtractionUsd, judgeUsd: totalJudgeUsd } = calculateTotalCosts(matrixResult.cells);
  const totalUsd = totalExtractionUsd + totalJudgeUsd;

  if (isDryRun || totalUsd > 0) {
    // skipcq: JS-0002
    console.log("\nEstimated Cost Summary:");
    // skipcq: JS-0002
    console.log(`  Extraction: $${totalExtractionUsd.toFixed(4)}`);
    // skipcq: JS-0002
    console.log(`  Judge:      $${totalJudgeUsd.toFixed(4)}`);
    // skipcq: JS-0002
    console.log(`  Total:      $${totalUsd.toFixed(4)}`);

    const BUDGET_CEILING = 25.00;
    if (totalUsd > BUDGET_CEILING) {
       // skipcq: JS-0002
       console.warn(`\nWARNING: Estimated cost ($${totalUsd.toFixed(4)}) exceeds Task 004 full-matrix budget ceiling ($${BUDGET_CEILING.toFixed(2)}).`);
    }
  }
};

const validateBasicInputs = (parsedOpts: EvalRunOptions, variantIds: string[]) => {
  if (!["both", "json", "md"].includes(parsedOpts.format)) {
    // skipcq: JS-0002
    console.error(`Invalid format: ${parsedOpts.format}. Must be one of: both, json, md`);
    return EXIT_INVALID_OPTIONS;
  }

  if (!parsedOpts.corpusPath) {
    // skipcq: JS-0002
    console.error("Error: --corpus <path> is required.");
    return EXIT_INVALID_OPTIONS;
  }

  const emptyVariantsError = validateNonEmptyList(variantIds, "--variants");
  if (emptyVariantsError !== EXIT_SUCCESS) return emptyVariantsError;

  const invalidVariants = variantIds.filter(v => !isValidVariant(v));
  if (invalidVariants.length > 0) {
    // skipcq: JS-0002
    console.error(`Invalid variants provided: ${invalidVariants.join(", ")}`);
    // skipcq: JS-0002
    console.error(`Valid variants: ${EXTRACTOR_VARIANTS.join(", ")}`);
    return EXIT_INVALID_OPTIONS;
  }

  // Validate positive numeric options
  const error1 = validatePositiveNumber(parsedOpts.maxConcurrency, "--max-concurrency");
  if (error1 !== 0) return error1;
  const error2 = validatePositiveNumber(parsedOpts.timeoutMs, "--timeout");
  if (error2 !== 0) return error2;
  const error3 = validatePositiveNumber(parsedOpts.judgeMaxTokens, "--judge-max-tokens");
  if (error3 !== 0) return error3;
  const error4 = validatePositiveNumber(parsedOpts.extractionMaxTokens, "--extraction-max-tokens");
  if (error4 !== 0) return error4;
  const error5 = validatePositiveNumber(parsedOpts.extractionMaxChunks, "--extraction-max-chunks");
  if (error5 !== 0) return error5;

  return EXIT_SUCCESS;
};

const validateRunId = (runId: string): string | null => {
  if (typeof runId !== "string") {
    return null;
  }

  // Empty run ID is valid (uses default paths)
  if (runId.length === 0) {
    return runId;
  }

  // Use shared validation, but provide custom error messages for CLI context
  const validated = validateSafeId(runId);
  if (!validated) {
    // skipcq: JS-0002
    console.error("Error: --run-id must be 100 characters or less, contain only alphanumeric characters, hyphens, and underscores, and must not contain path traversal sequences ('..').");
    return null;
  }

  return validated;
};

const handleExecutionResult = async (result: MatrixResult, parsedOpts: EvalRunOptions, finalOutputDir: string) => {
  if (parsedOpts.dryRun) {
    // skipcq: JS-0002
    console.log("Dry run complete. No real LLM calls were made.");
    if (result.metadata.failedCellCount > 0) {
      // skipcq: JS-0002
      console.warn(`Dry run detected ${result.metadata.failedCellCount} failed cells (e.g. missing transcripts). Resolve before a real run.`);
      return EXIT_ERROR;
    }
    return EXIT_SUCCESS;
  }

  const report = aggregateMatrixResults(result.cells);
  const reportStub = parsedOpts.runId ? `eval-matrix-${parsedOpts.runId}` : "eval-matrix";
  await writeReports(report, finalOutputDir, parsedOpts.format, reportStub);

  if (result.metadata.partialFailureCount > 0) {
    // skipcq: JS-0002
    console.warn(`Evaluation completed with ${result.metadata.partialFailureCount} partial-failure cell(s) (some judges failed but partial scores were kept).`);
  }

  if (result.metadata.failedCellCount > 0) {
    // skipcq: JS-0002
    console.warn(`Evaluation completed with ${result.metadata.failedCellCount} failed cells.`);
    return 1;
  }

  return 0;
};

const executeMatrixEvaluation = async (
  corpusData: CorpusEntry[],
  models: EvalModel[],
  parsedOpts: EvalRunOptions,
  variantIds: string[],
  judgeModels: string[],
  runCacheDir: string,
  finalOutputDir: string,
  config: ResolvedConfig
) => {
  const matrixOptions: MatrixOptions = {
    outputDir: finalOutputDir,
    cacheDir: runCacheDir,
    runId: parsedOpts.runId,
    transcriptDir: parsedOpts.transcriptDir,
    resume: parsedOpts.resume,
    dryRun: parsedOpts.dryRun,
    variants: variantIds as ExtractorVariantId[],
    judgeModels,
    maxConcurrency: parsedOpts.maxConcurrency,
    timeoutMs: parsedOpts.timeoutMs,
    extractionMaxTokens: parsedOpts.extractionMaxTokens,
    extractionMaxChunks: parsedOpts.extractionMaxChunks,
    judgeMaxTokens: parsedOpts.judgeMaxTokens,
    extractorClientFactory: (modelId: string) => createProviderAwareClient(modelId, config.llm),
    judgeClientFactory: (modelId: string) => createProviderAwareClient(modelId, config.llm)
  };

  const result = await runEvaluationMatrix(corpusData, models, matrixOptions);
  handleCostReporting(result, parsedOpts.dryRun);
  return result;
};

const parseEvalOptions = (positionals: string[], options: Record<string, string | boolean | undefined>): { mode: string; cleanOptions: CliOptions } | number => {
  const mode = positionals[1];
  if (mode !== "matrix" && mode !== "narrow-manual-baseline") {
    console.error("Usage: eval <matrix|narrow-manual-baseline> [options]");
    return 1;
  }

  const cleanOptions: CliOptions = {};
  for (const [k, v] of Object.entries(options)) {
    if (v !== undefined) cleanOptions[k] = v;
  }
  return { mode, cleanOptions };
};

interface NarrowEvalOptions {
  dryRun: boolean;
  mode: "fast-triage" | "compare" | "deep";
  corpusPath: string;
  transcriptDir: string;
  manualBaselineDir: string;
  outputDir: string;
  modelsStr: string;
  variantsStr: string;
  judgeModelIds: string[];
  fallbackModelId: string;
  maxConcurrency: number;
  timeoutMs: number;
  judgeMaxTokens: number;
  judgeEnabled: boolean;
  includeManualBaselines: boolean;
  maxRpmGeminiFlashLite: number;
  maxRpmGeminiEmbedding: number;
  maxRpmGpt54: number;
  shortlistPerVideo?: number;
  maxEmbeddingRequestsPerRun?: number;
  maxRefinedSelfImproveCellsPerRun?: number;
  refreshStage?: "shortlist" | "refine" | "score" | "judge" | "all";
}

const hasOption = (options: CliOptions, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(options, key);

const parseNarrowEvalOptions = (cleanOptions: CliOptions): NarrowEvalOptions => {
  const rawMode = optionString(cleanOptions, "mode", "fast-triage");
  const mode = rawMode === "quota-safe" ? "fast-triage" : rawMode;

  const validModes = ["fast-triage", "compare", "deep"];
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid narrow eval mode '${mode}'. Supported modes: ${validModes.join(", ")}`);
  }

  const judgeDefault = mode === "fast-triage" ? "" : optionString(cleanOptions, "judge-model", "gpt-5.4");
  const judgeModelsStr = optionString(cleanOptions, "judge-models", judgeDefault);
  const judgeEnabled = hasOption(cleanOptions, "judge")
    ? optionBool(cleanOptions, "judge")
    : mode !== "fast-triage";
  const includeManualBaselines = hasOption(cleanOptions, "with-manual-baselines")
    ? optionBool(cleanOptions, "with-manual-baselines")
    : mode !== "fast-triage";
  return {
    dryRun: optionBool(cleanOptions, "dry-run"),
    mode: mode as NarrowEvalOptions["mode"],
    corpusPath: resolveRepoRelativePath(optionString(cleanOptions, "corpus", "out/eval-matrix/corpus.narrow-manual-baseline.json")),
    transcriptDir: resolveRepoRelativePath(optionString(cleanOptions, "transcript-dir", "out/eval-matrix/transcripts")),
    manualBaselineDir: resolveRepoRelativePath(optionString(cleanOptions, "manual-baseline-dir", "out/eval-matrix/manual-baseline")),
    outputDir: resolveRepoRelativePath(optionString(cleanOptions, "output-dir", "out/eval-matrix/reports/narrow-manual-baseline")),
    modelsStr: optionString(cleanOptions, "models", "gemini-3.1-flash-lite-preview"),
    variantsStr: optionString(cleanOptions, "variants", "raw,editorial-pass-v1,self-improve-v1"),
    judgeModelIds: judgeEnabled ? parseCsvList(judgeModelsStr) : [],
    fallbackModelId: optionString(cleanOptions, "fallback-model", "gemini-3.1-flash-lite-preview"),
    maxConcurrency: optionNumber(cleanOptions, "max-concurrency", 1),
    timeoutMs: optionNumber(cleanOptions, "timeout-ms", 120000),
    judgeMaxTokens: optionNumber(cleanOptions, "judge-max-tokens", 4000),
    judgeEnabled,
    includeManualBaselines,
    maxRpmGeminiFlashLite: optionNumber(cleanOptions, "max-rpm-gemini-flash-lite", 12),
    maxRpmGeminiEmbedding: optionNumber(cleanOptions, "max-rpm-gemini-embedding", 80),
    maxRpmGpt54: optionNumber(cleanOptions, "max-rpm-gpt54", 20),
    shortlistPerVideo: optionNumber(cleanOptions, "shortlist-per-video", 0) || undefined,
    maxEmbeddingRequestsPerRun: optionNumber(cleanOptions, "max-embedding-requests-per-run", 0) || undefined,
    maxRefinedSelfImproveCellsPerRun: optionNumber(cleanOptions, "max-refined-self-improve-cells-per-run", 0) || undefined,
    refreshStage: optionString(cleanOptions, "refresh-stage", "") as NarrowEvalOptions["refreshStage"] | undefined,
  };
};

const printNarrowPlan = (opts: NarrowEvalOptions, models: EvalModel[], variants: string[]) => {
  console.log(`Narrow Manual Baseline Comparison Plan:
Mode: ${opts.mode}
Corpus: ${opts.corpusPath}
Manual Baseline Dir: ${opts.manualBaselineDir}
Transcript Dir: ${opts.transcriptDir}
Models: ${models.map((model) => model.id).join(", ")}
Variants: ${variants.join(", ")}
Prompt Configs: baseline, hierarchy-first, enumeration-first
Judge Enabled: ${opts.judgeEnabled}
Judge Models: ${opts.judgeModelIds.join(", ") || "none"}
Manual Baselines: ${opts.includeManualBaselines}
Fallback Model: ${opts.fallbackModelId}
Output Dir: ${opts.outputDir}
Max Concurrency: ${opts.maxConcurrency}
Timeout: ${opts.timeoutMs}ms
Judge Max Tokens: ${opts.judgeMaxTokens}
RPM Caps: gemini-flash-lite=${opts.maxRpmGeminiFlashLite}, gemini-embedding=${opts.maxRpmGeminiEmbedding}, gpt-5.4=${opts.maxRpmGpt54}
Refresh Stage: ${opts.refreshStage || "none"}
`);
};

const NARROW_STAGE_ORDER = ["shortlist", "refine", "score", "judge"] as const;

const invalidateNarrowStages = (outputDir: string, refreshStage: NarrowEvalOptions["refreshStage"]) => {
  if (!refreshStage) return;

  const stagesDir = join(outputDir, "stages");
  if (refreshStage === "all") {
    rmSync(stagesDir, { recursive: true, force: true });
    console.log(`[refresh-stage] removed ${stagesDir}`);
    return;
  }

  const startIndex = NARROW_STAGE_ORDER.indexOf(refreshStage);
  if (startIndex === -1) {
    throw new Error(`Invalid refresh stage: ${refreshStage}`);
  }

  const stagesToInvalidate = NARROW_STAGE_ORDER.slice(startIndex);
  for (const stage of stagesToInvalidate) {
    const stagePath = join(stagesDir, `${stage}.json`);
    rmSync(stagePath, { force: true });
    console.log(`[refresh-stage] removed ${stagePath}`);
  }

  // If score or judge is invalidated, we must also clear the per-video artifacts
  if (stagesToInvalidate.includes("score") || stagesToInvalidate.includes("judge")) {
    if (existsSync(stagesDir)) {
      const files = readdirSync(stagesDir);
      for (const file of files) {
        if (file.startsWith("score-video-") && file.endsWith(".json")) {
          const filePath = join(stagesDir, file);
          rmSync(filePath, { force: true });
          console.log(`[refresh-stage] removed ${filePath}`);
        }
      }
    }
  }
};

const runNarrowManualBaseline = async (
  cleanOptions: CliOptions,
  config: ResolvedConfig
): Promise<number> => {
  const parsedOpts = parseNarrowEvalOptions(cleanOptions);
  if (optionString(cleanOptions, "mode", "fast-triage") === "quota-safe") {
    console.warn("Mode 'quota-safe' is deprecated; using 'fast-triage'.");
  }
  if (parsedOpts.refreshStage && !["shortlist", "refine", "score", "judge", "all"].includes(parsedOpts.refreshStage)) {
    console.error(`Invalid refresh stage: ${parsedOpts.refreshStage}`);
    return 2;
  }
  const models = getModelsFromIdsOrTier(parsedOpts.modelsStr, "");
  if (typeof models === "number") return models;

  const variantIds = parseCsvList(parsedOpts.variantsStr);
  const invalidVariants = variantIds.filter((variant) => !isValidVariant(variant));
  if (invalidVariants.length > 0) {
    console.error(`Invalid variants: ${invalidVariants.join(", ")}`);
    return 2;
  }

  const corpusResult = loadNarrowCorpusData(parsedOpts.corpusPath);
  if (!corpusResult.ok || !corpusResult.data) return corpusResult.error ?? 1;

  if (parsedOpts.judgeEnabled && parsedOpts.judgeModelIds.length === 0) {
    console.error("At least one narrow judge model is required.");
    return 1;
  }
  const unknownJudgeModels = parsedOpts.judgeModelIds.filter((modelId) => !getModel(modelId));
  if (unknownJudgeModels.length > 0) {
    console.error(`Unknown judge model(s): ${unknownJudgeModels.join(", ")}`);
    return 1;
  }
  if (!getModel(parsedOpts.fallbackModelId)) {
    console.error(`Unknown fallback model: ${parsedOpts.fallbackModelId}`);
    return 1;
  }

  const requiredModelIds = Array.from(new Set([
    ...models.map((model) => model.id),
    ...parsedOpts.judgeModelIds,
    parsedOpts.fallbackModelId,
  ]));

  const missingCredentialModels = requiredModelIds.filter((modelId) => {
    const connection = resolveProviderConnection(modelId, config.llm);
    return !connection.apiKey || connection.apiKey.trim().length === 0;
  });
  if (!parsedOpts.dryRun && missingCredentialModels.length > 0) {
    console.error(
      `Missing provider credentials for: ${missingCredentialModels.join(", ")}. ` +
      "Set the relevant API keys before running the narrow manual baseline comparison."
    );
    return 1;
  }

  printNarrowPlan(parsedOpts, models, variantIds);

  if (parsedOpts.dryRun) {
    console.log("Dry run only; no harness execution or comparison performed.");
    return 0;
  }

  invalidateNarrowStages(parsedOpts.outputDir, parsedOpts.refreshStage);

  const report = await runNarrowManualBaselineComparison({
    corpus: corpusResult.data,
    transcriptDir: parsedOpts.transcriptDir,
    manualBaselineDir: parsedOpts.manualBaselineDir,
    outputDir: parsedOpts.outputDir,
    models,
    variants: variantIds as ExtractorVariantId[],
    judgeModelIds: parsedOpts.judgeModelIds,
    fallbackModelId: parsedOpts.fallbackModelId,
    config,
    clientFactory: (modelId: string) => createProviderAwareClient(
      modelId,
      config.llm,
      {
        timeoutMs: getNarrowEvalModelProfile(modelId).requestTimeoutMs,
        maxRequestsPerMinute: modelId === "gpt-5.4"
          ? parsedOpts.maxRpmGpt54
          : modelId === "gemini-3.1-flash-lite-preview"
            ? parsedOpts.maxRpmGeminiFlashLite
            : undefined,
      }
    ),
    maxConcurrency: parsedOpts.maxConcurrency,
    timeoutMs: parsedOpts.timeoutMs,
    judgeMaxTokens: parsedOpts.judgeMaxTokens,
    runMode: parsedOpts.mode,
    judgeEnabled: parsedOpts.judgeEnabled,
    includeManualBaselines: parsedOpts.includeManualBaselines,
    maxEmbeddingRequestsPerMinute: parsedOpts.maxRpmGeminiEmbedding,
    shortlistPerVideo: parsedOpts.shortlistPerVideo,
    maxEmbeddingRequestsPerRun: parsedOpts.maxEmbeddingRequestsPerRun,
    maxRefinedSelfImproveCellsPerRun: parsedOpts.maxRefinedSelfImproveCellsPerRun,
  });

  const files = await writeNarrowComparisonReport(report, parsedOpts.outputDir, "harness-test");
  console.log(`Wrote Markdown report to ${files.mdPath}`);
  console.log(`Wrote JSON report to ${files.jsonPath}`);
  return 0;
};

const resolveEvalExecutionParams = (parsedOpts: EvalRunOptions) => {
  const validatedRunId = validateRunId(parsedOpts.runId);
  if (validatedRunId === null) {
    return { runCacheDir: null, finalOutputDir: null, error: 1 };
  }

  const runCacheDir = resolveCacheDir(validatedRunId);
  const finalOutputDir = parsedOpts.outputDir || (validatedRunId ? join("out/eval-matrix/runs", validatedRunId) : "out/eval-matrix/reports");

  return { runCacheDir, finalOutputDir, error: 0 };
};

const loadExecutionData = (parsedOpts: EvalRunOptions) => {
  const corpusResult = loadCorpusData(parsedOpts.corpusPath);
  const models = getModelsFromIdsOrTier(parsedOpts.modelsStr, parsedOpts.tier);

  return { corpusResult, models };
};

/**
 * Main entry point for the CLI evaluation matrix command.
 * Parses options, validates inputs, runs the evaluation matrix, and generates reports.
 *
 * @param positionals - Positional CLI arguments (currently unused)
 * @param options - CLI options from commander
 * @param config - Resolved AIDHA configuration
 * @returns Exit code (0 for success, non-zero for errors)
 *
 * Exit codes:
 * - 0: Success
 * - 1: General error
 * - 2: Invalid options
 * - 3: Dry-run mode (no execution)
 */
export const runEvalMatrix = async (
  positionals: string[],
  options: Record<string, string | boolean | undefined>,
  config: ResolvedConfig
): Promise<number> => {
  try {
    const parseResult = parseEvalOptions(positionals, options);
    if (typeof parseResult === "number") return parseResult;
    const { mode, cleanOptions } = parseResult;

    if (mode === "narrow-manual-baseline") {
      return await runNarrowManualBaseline(cleanOptions, config);
    }

    const cacheInvalidationResult = invalidateCache(cleanOptions);
    if (cacheInvalidationResult !== undefined) return cacheInvalidationResult;

    const parsedOpts = parseRunOptions(cleanOptions);
    const variantIds = parseCsvList(parsedOpts.variantsStr);

    const validationError = validateBasicInputs(parsedOpts, variantIds);
    if (validationError !== 0) return validationError;

    const { corpusResult, models } = loadExecutionData(parsedOpts);
    if (typeof models === "number") return models;
    if (!corpusResult.ok || !corpusResult.data) return corpusResult.error ?? 1;

    const judgeModels = parseCsvList(parsedOpts.judgeModelsStr);

    const emptyJudgeModelsError = validateNonEmptyList(judgeModels, "--judge-models");
    if (emptyJudgeModelsError !== EXIT_SUCCESS) return emptyJudgeModelsError;

    // Validate judge models against registry
    const unknownJudgeModels = judgeModels.filter(id => !getModel(id));
    if (unknownJudgeModels.length > 0) {
      // skipcq: JS-0002
      console.error(`Unknown judge model(s): ${unknownJudgeModels.join(", ")}. Check MODEL_REGISTRY for valid IDs.`);
      return 1;
    }

    const { runCacheDir, finalOutputDir, error: runParamsError } = resolveEvalExecutionParams(parsedOpts);
    if (runParamsError !== 0 || runCacheDir === null || finalOutputDir === null) return runParamsError ?? 1;

    printPlan({ ...parsedOpts, models, judgeModels, variantIds, finalOutputDir, runCacheDir });

    // skipcq: JS-0002
    console.log("Running matrix evaluation...");

    const result = await executeMatrixEvaluation(
      corpusResult.data, models, parsedOpts, variantIds, judgeModels, runCacheDir, finalOutputDir, config
    );

    return await handleExecutionResult(result, parsedOpts, finalOutputDir);
  } catch (error) {
    // Log sanitized message only - full error may contain secrets
    const message = error instanceof Error ? error.message : String(error);
    // skipcq: JS-0002
    console.error("Evaluation failed:", message);
    return 1;
  }
};
