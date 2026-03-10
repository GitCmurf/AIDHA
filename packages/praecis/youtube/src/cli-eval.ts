import type { ResolvedConfig } from "@aidha/config";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runEvaluationMatrix, type MatrixOptions } from "./eval/matrix-runner.js";
import { getModel, MODEL_REGISTRY, type EvalModel } from "./eval/model-registry.js";
import { aggregateMatrixResults, type MatrixReport } from "./eval/matrix-aggregator.js";
import { renderMatrixReport } from "./eval/report-markdown.js";
import { exportMatrixJson } from "./eval/report-json.js";
import { EXTRACTOR_VARIANTS, isValidVariant } from "./eval/extractor-variants.js";
import { createLlmClientFromConfig } from "./extract/llm-client.js";
import { optionString, optionBool, optionNumber, type CliOptions } from "./cli.js";
import { CorpusSchema } from "./eval/corpus-schema.js";

export const createProviderAwareClient = (modelId: string, baseConfig: ResolvedConfig["llm"]) => {
  const model = getModel(modelId);
  const provider = model?.provider || "openai";

  let apiKey = baseConfig.apiKey;
  // ONLY inherit baseConfig.baseUrl if the provider is openai, otherwise it might send Anthropic requests to OpenAI
  let baseUrl = model?.baseUrl;

  if (provider === "openai") {
    apiKey = process.env["OPENAI_API_KEY"] || apiKey;
    baseUrl = baseUrl || baseConfig.baseUrl || "https://api.openai.com/v1";
  } else if (provider === "anthropic" || provider === "google" || provider === "meta" || provider === "openrouter") {
    apiKey = process.env["OPENROUTER_API_KEY"] || apiKey;
    baseUrl = baseUrl || "https://openrouter.ai/api/v1";
  } else if (provider === "deepseek") {
    apiKey = process.env["DEEPSEEK_API_KEY"] || apiKey;
    baseUrl = baseUrl || "https://api.deepseek.com/beta";
  } else {
    throw new Error(`Unsupported provider '${provider}' for model ${modelId}. Cannot resolve baseUrl.`);
  }

  if (!baseUrl) {
    throw new Error(`Failed to resolve baseUrl for model ${modelId} (provider: ${provider})`);
  }

  const clientResult = createLlmClientFromConfig({
    ...baseConfig,
    model: modelId,
    apiKey,
    baseUrl,
  });

  if (!clientResult.ok) throw clientResult.error;
  return clientResult.value;
};

export const runEvalMatrix = async (
  positionals: string[],
  options: Record<string, string | boolean | undefined>,
  config: ResolvedConfig
): Promise<number> => {
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

  const loadCorpusData = (corpusPath: string) => {
    try {
      const raw = JSON.parse(readFileSync(corpusPath, "utf-8"));
      const parsed = CorpusSchema.safeParse(raw);
      if (!parsed.success) {
        console.error("Corpus file validation failed:", JSON.stringify(parsed.error.format(), null, 2));
        return { ok: false, error: 1 };
      }
      return { ok: true, data: parsed.data };
    } catch (err) {
      console.error(`Failed to read or validate corpus file at ${corpusPath}:`, err);
      return { ok: false, error: 1 };
    }
  };

  const getModelsFromIdsOrTier = (modelsStr: string, tier: string): EvalModel[] | number => {
    let modelIds: string[] = [];
    if (modelsStr) {
      modelIds = modelsStr.split(",").map(s => s.trim()).filter(Boolean);
    } else if (tier) {
      modelIds = MODEL_REGISTRY.filter(m => m.tier === tier).map(m => m.id);
      if (modelIds.length === 0) {
        // skipcq: JS-0002
        console.error(`No models found for tier: ${tier}`);
        return 1;
      }
    } else {
      modelIds = ["gpt-4o-mini"];
    }

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

    // Write per-cell artifacts
    const cellsDir = join(outputDir, "cells");
    mkdirSync(cellsDir, { recursive: true });
    for (const cell of report.cells) {
      const cellFileName = `${cell.videoId}-${cell.modelId}-${cell.extractorVariantId}.json`;
      const cellPath = join(cellsDir, cellFileName);
      writeFileSync(cellPath, JSON.stringify(cell, null, 2));
    }
    // skipcq: JS-0002
    console.log(`Wrote ${report.cells.length} cell artifacts to ${cellsDir}`);
  };

  const parseRunOptions = (cleanOptions: CliOptions) => {
    const dryRun = optionBool(cleanOptions, "dry-run");
    const runId = optionString(cleanOptions, "run-id", "");
    const corpusPath = optionString(cleanOptions, "corpus", "");
    const transcriptDir = optionString(cleanOptions, "transcript-dir", "out/eval-matrix/transcripts");
    const modelsStr = optionString(cleanOptions, "models", "");
    const tier = optionString(cleanOptions, "tier", "");
    const judgeModelsStr = optionString(cleanOptions, "judge-models", "gpt-4o");
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

  const printPlan = (planArgs: Record<string, any>) => {
    // skipcq: JS-0002
    console.log(`Evaluation Matrix Plan:
  Run ID: ${planArgs.runId || 'default'}
  Corpus: ${planArgs.corpusPath}
  Models: ${planArgs.models.map((m: any) => m.id).join(", ")}
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

  try {
    const mode = positionals[1]; // matrix
    if (mode !== "matrix") {
      // skipcq: JS-0002
      console.error("Usage: eval matrix [options]");
      return 1;
    }

    // Cast options to satisfy CliOptions
    const cleanOptions: CliOptions = {};
    for (const [k, v] of Object.entries(options)) {
      if (v !== undefined) cleanOptions[k] = v;
    }

    const cacheInvalidationResult = invalidateCache(cleanOptions);
    if (cacheInvalidationResult !== undefined) return cacheInvalidationResult;

    const parsedOpts = parseRunOptions(cleanOptions);

    if (!["both", "json", "md"].includes(parsedOpts.format)) {
      // skipcq: JS-0002
      console.error(`Invalid format: ${parsedOpts.format}. Must be one of: both, json, md`);
      return 1;
    }

    if (!parsedOpts.corpusPath) {
      // skipcq: JS-0002
      console.error("Error: --corpus <path> is required.");
      return 1;
    }

    const models = getModelsFromIdsOrTier(parsedOpts.modelsStr, parsedOpts.tier);
    if (typeof models === "number") return models;

    const judgeModels = parsedOpts.judgeModelsStr.split(",").map(s => s.trim()).filter(Boolean);
    const variantIds = parsedOpts.variantsStr.split(",").map(s => s.trim()).filter(Boolean);

    const invalidVariants = variantIds.filter(v => !isValidVariant(v));
    if (invalidVariants.length > 0) {
      // skipcq: JS-0002
      console.error(`Invalid variants provided: ${invalidVariants.join(", ")}`);
      // skipcq: JS-0002
      console.error(`Valid variants: ${EXTRACTOR_VARIANTS.join(", ")}`);
      return 1;
    }

    const runCacheDir = parsedOpts.runId ? join(".cache/extraction", parsedOpts.runId) : ".cache/extraction";
    const finalOutputDir = parsedOpts.outputDir || (parsedOpts.runId ? join("out/eval-matrix/runs", parsedOpts.runId) : "out/eval-matrix/reports");

    printPlan({ ...parsedOpts, models, judgeModels, variantIds, finalOutputDir, runCacheDir });

    // skipcq: JS-0002
    console.log("Running matrix evaluation...");

    const corpusResult = loadCorpusData(parsedOpts.corpusPath);
    if (!corpusResult.ok || !corpusResult.data) return corpusResult.error ?? 1;
    const corpusData = corpusResult.data;

    const matrixOptions: MatrixOptions = {
      outputDir: finalOutputDir,
      cacheDir: runCacheDir,
      runId: parsedOpts.runId,
      transcriptDir: parsedOpts.transcriptDir,
      resume: parsedOpts.resume,
      dryRun: parsedOpts.dryRun,
      variants: variantIds as any[],
      judgeModels,
      maxConcurrency: parsedOpts.maxConcurrency,
      timeoutMs: parsedOpts.timeoutMs,
      extractionMaxTokens: parsedOpts.extractionMaxTokens,
      extractionMaxChunks: parsedOpts.extractionMaxChunks,
      judgeMaxTokens: parsedOpts.judgeMaxTokens,
      extractorClientFactory: (modelId: string) => {
        return createProviderAwareClient(modelId, config.llm);
      },
      judgeClientFactory: (modelId: string) => {
        return createProviderAwareClient(modelId, config.llm);
      }
    };

    const result = await runEvaluationMatrix(corpusData, models, matrixOptions);

    const handleCostReporting = (matrixResult: MatrixResult, isDryRun: boolean) => {
      let totalExtractionUsd = 0;
      let totalJudgeUsd = 0;
      for (const cell of matrixResult.cells) {
        if (cell.costEstimate) {
          totalExtractionUsd += cell.costEstimate.extractionUsd;
          totalJudgeUsd += cell.costEstimate.judgeUsd;
        }
      }
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

        const BUDGET_CEILING = 25.00; // $25.00 as per Task 004 full-matrix budget
        if (totalUsd > BUDGET_CEILING) {
           // skipcq: JS-0002
           console.warn(`\nWARNING: Estimated cost ($${totalUsd.toFixed(4)}) exceeds Task 004 full-matrix budget ceiling ($${BUDGET_CEILING.toFixed(2)}).`);
        }
      }
    };

    handleCostReporting(result, parsedOpts.dryRun);

    if (parsedOpts.dryRun) {
      // skipcq: JS-0002
      console.log("Dry run complete. No real LLM calls were made.");
      if (result.metadata.failedCellCount > 0) {
        // skipcq: JS-0002
        console.warn(`Dry run detected ${result.metadata.failedCellCount} failed cells (e.g. missing transcripts). Resolve before a real run.`);
        return 1;
      }
      return 0;
    }

    const report = aggregateMatrixResults(result.cells);
    writeReports(report, finalOutputDir, parsedOpts.format);

    if (result.metadata.failedCellCount > 0) {
      // skipcq: JS-0002
      console.warn(`Evaluation completed with ${result.metadata.failedCellCount} failed cells.`);
      return 1;
    }

    return 0;
  } catch (error) {
    // skipcq: JS-0002
    console.error("Evaluation failed:", error);
    return 1;
  }
};
