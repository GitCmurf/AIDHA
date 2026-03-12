import type { ResolvedConfig } from "@aidha/config";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runEvaluationMatrix, type MatrixOptions, type MatrixResult } from "./eval/matrix-runner.js";
import { getModel, MODEL_REGISTRY, type EvalModel } from "./eval/model-registry.js";
import { aggregateMatrixResults, type MatrixReport } from "./eval/matrix-aggregator.js";
import { renderMatrixReport } from "./eval/report-markdown.js";
import { exportMatrixJson } from "./eval/report-json.js";
import { EXTRACTOR_VARIANTS, isValidVariant, type ExtractorVariantId } from "./eval/extractor-variants.js";
import { createLlmClientFromConfig } from "./extract/llm-client.js";
import { optionString, optionBool, optionNumber, type CliOptions } from "./cli.js";
import { CorpusSchema, type CorpusEntry } from "./eval/corpus-schema.js";
import { validateSafeId } from "./utils/ids.js";
import { sanitizeFilename } from "./utils/ids.js";

// ─────────────────────────────────────────────────────────────────────────────
// Provider Configuration
// ─────────────────────────────────────────────────────────────────────────────

const getOpenAiConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => ({
  apiKey: process.env["OPENAI_API_KEY"] || apiKey,
  baseUrl: baseUrl || baseConfigBaseUrl || "https://api.openai.com/v1"
});

const getGoogleAiStudioConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => ({
  apiKey: process.env["GOOGLE_AISTUDIO_API_KEY"] || apiKey,
  baseUrl: baseUrl || baseConfigBaseUrl || "https://generativelanguage.googleapis.com/v1beta"
});

const getZaiConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => ({
  apiKey: process.env["ZAI_API_KEY"] || apiKey,
  baseUrl: baseUrl || baseConfigBaseUrl || "https://api.zai.ai/v1"
});

const getXiaomiConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => ({
  apiKey: process.env["XIAOMI_API_KEY"] || apiKey,
  baseUrl: baseUrl || baseConfigBaseUrl || "https://api.xiaomi.com/v1"
});

// Reserved for future use - OpenRouter support when ModelProvider is expanded
const getOpenRouterConfig = (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => ({
  apiKey: process.env["OPENROUTER_API_KEY"] || apiKey,
  baseUrl: baseUrl || baseConfigBaseUrl || "https://openrouter.ai/api/v1"
});

// Only these four providers are supported (matching ModelProvider in model-registry.ts)
// anthropic, google, meta, openrouter were removed as dead code - they were unreachable
const providerConfigGetters: Record<string, (apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => { apiKey: string; baseUrl: string } | null> = {
  openai: getOpenAiConfig,
  "google-aistudio": getGoogleAiStudioConfig,
  zai: getZaiConfig,
  xiaomi: getXiaomiConfig,
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exit codes for the CLI.
 * 0 = Success
 * 1 = Error (validation failed, execution failed)
 * 3 = Dry run completed with no failed cells
 */
const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_DRY_RUN = 3;

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
 * @returns EXIT_SUCCESS if valid, EXIT_ERROR if invalid
 */
function validateNonEmptyList(items: string[], optionName: string): number {
  if (items.length === 0) {
    // skipcq: JS-0002
    console.error(`Error: ${optionName} must contain at least one valid value.`);
    return EXIT_ERROR;
  }
  return EXIT_SUCCESS;
}

/**
 * Validates that a number is positive (>= 1).
 * @param value - The value to validate
 * @param optionName - The CLI option name for error messages
 * @returns EXIT_SUCCESS if valid, EXIT_ERROR if invalid
 */
function validatePositiveNumber(value: number | undefined, optionName: string): number {
  if (value !== undefined && value < 1) {
    // skipcq: JS-0002
    console.error(`Error: ${optionName} must be a positive number.`);
    return EXIT_ERROR;
  }
  return EXIT_SUCCESS;
}

const resolveProviderConfig = (provider: string, apiKey: string, baseUrl?: string, baseConfigBaseUrl?: string) => {
  const getter = providerConfigGetters[provider];
  return getter ? getter(apiKey, baseUrl, baseConfigBaseUrl) : null;
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
export const createProviderAwareClient = (modelId: string, baseConfig: ResolvedConfig["llm"]) => {
  const model = getModel(modelId);
  if (!model) {
    throw new Error(`Model '${modelId}' not found in the evaluation registry.`);
  }
  const provider = model.provider;

  const resolved = resolveProviderConfig(provider, baseConfig.apiKey, model.baseUrl, baseConfig.baseUrl);
  if (!resolved) {
    throw new Error(`Unsupported provider '${provider}' for model ${modelId}. Cannot resolve baseUrl.`);
  }

  if (!resolved.baseUrl) {
    throw new Error(`Failed to resolve baseUrl for model ${modelId} (provider: ${provider})`);
  }

  const clientResult = createLlmClientFromConfig({
    ...baseConfig,
    model: modelId,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
  });

  if (!clientResult.ok) throw clientResult.error;
  return clientResult.value;
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

const resolveModelIds = (modelsStr: string, tier: string): string[] | number => {
  if (modelsStr) {
    const ids = modelsStr.split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) return ids;
  }
  if (tier) {
    const ids = MODEL_REGISTRY.filter(m => m.tier === tier).map(m => m.id);
    if (ids.length === 0) {
      // skipcq: JS-0002
      console.error(`No models found for tier: ${tier}`);
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

const writeCellArtifacts = (cells: MatrixResult["cells"], outputDir: string) => {
  const cellsDir = join(outputDir, "cells");
  mkdirSync(cellsDir, { recursive: true });
  for (const cell of cells) {
    const safeVideoId = sanitizeFilename(cell.videoId);
    const safeModelId = sanitizeFilename(cell.modelId);
    const safeVariantId = sanitizeFilename(cell.extractorVariantId);
    const cellFileName = `${safeVideoId}-${safeModelId}-${safeVariantId}.json`;
    const cellPath = join(cellsDir, cellFileName);
    writeFileSync(cellPath, JSON.stringify(cell, null, 2));
  }
  // skipcq: JS-0002
  console.log(`Wrote ${cells.length} cell artifacts to ${cellsDir}`);
};

const writeReports = (report: MatrixReport, outputDir: string, format: string) => {
  mkdirSync(outputDir, { recursive: true });

  if (format === "both" || format === "json") {
    const jsonPath = join(outputDir, "latest.json");
    writeFileSync(jsonPath, exportMatrixJson(report, { pretty: true }));
    // skipcq: JS-0002
    console.log(`Wrote JSON report to ${jsonPath}`);
  }

  if (format === "both" || format === "md") {
    const mdPath = join(outputDir, "latest.md");
    writeFileSync(mdPath, renderMatrixReport(report));
    // skipcq: JS-0002
    console.log(`Wrote Markdown report to ${mdPath}`);
  }

  writeCellArtifacts(report.cells, outputDir);
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
  const extractionMaxTokens = optionNumber(cleanOptions, "extraction-max-tokens", 0) || undefined;
  const extractionMaxChunks = optionNumber(cleanOptions, "extraction-max-chunks", 0) || undefined;
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
  return 1;
};

const handleInvalidateRun = (invalidateRun: string, cacheDir: string): number => {
  if (!/^[a-zA-Z0-9_-]+$/.test(invalidateRun)) {
    // skipcq: JS-0002
    console.error("Error: --invalidate-run must contain only alphanumeric characters, hyphens, and underscores.");
    return 1;
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

  const cacheDir = ".cache/extraction";
  if (!existsSync(cacheDir)) {
    // skipcq: JS-0002
    console.log("No cache directory found to invalidate.");
    return 0;
  }

  return clearAll ? handleClearAll(cleanOptions, cacheDir) : handleInvalidateRun(invalidateRun, cacheDir);
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
    return EXIT_ERROR;
  }

  if (!parsedOpts.corpusPath) {
    // skipcq: JS-0002
    console.error("Error: --corpus <path> is required.");
    return EXIT_ERROR;
  }

  const emptyVariantsError = validateNonEmptyList(variantIds, "--variants");
  if (emptyVariantsError !== EXIT_SUCCESS) return emptyVariantsError;

  const invalidVariants = variantIds.filter(v => !isValidVariant(v));
  if (invalidVariants.length > 0) {
    // skipcq: JS-0002
    console.error(`Invalid variants provided: ${invalidVariants.join(", ")}`);
    // skipcq: JS-0002
    console.error(`Valid variants: ${EXTRACTOR_VARIANTS.join(", ")}`);
    return EXIT_ERROR;
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

const handleExecutionResult = (result: MatrixResult, parsedOpts: EvalRunOptions, finalOutputDir: string) => {
  if (parsedOpts.dryRun) {
    // skipcq: JS-0002
    console.log("Dry run complete. No real LLM calls were made.");
    if (result.metadata.failedCellCount > 0) {
      // skipcq: JS-0002
      console.warn(`Dry run detected ${result.metadata.failedCellCount} failed cells (e.g. missing transcripts). Resolve before a real run.`);
      return EXIT_ERROR;
    }
    return EXIT_DRY_RUN;
  }

  const report = aggregateMatrixResults(result.cells);
  writeReports(report, finalOutputDir, parsedOpts.format);

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
  if (mode !== "matrix") {
    // skipcq: JS-0002
    console.error("Usage: eval matrix [options]");
    return 1;
  }

  const cleanOptions: CliOptions = {};
  for (const [k, v] of Object.entries(options)) {
    if (v !== undefined) cleanOptions[k] = v;
  }
  return { mode, cleanOptions };
};

const resolveEvalExecutionParams = (parsedOpts: EvalRunOptions) => {
  const validatedRunId = validateRunId(parsedOpts.runId);
  if (validatedRunId === null) {
    return { runCacheDir: null, finalOutputDir: null, error: 1 };
  }

  const runCacheDir = validatedRunId ? join(".cache/extraction", validatedRunId) : ".cache/extraction";
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
    const { cleanOptions } = parseResult;

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

    return handleExecutionResult(result, parsedOpts, finalOutputDir);
  } catch (error) {
    // Log sanitized message only - full error may contain secrets
    const message = error instanceof Error ? error.message : String(error);
    // skipcq: JS-0002
    console.error("Evaluation failed:", message);
    return 1;
  }
};
