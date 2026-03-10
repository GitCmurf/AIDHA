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

export async function runEvalMatrix(
  positionals: string[],
  options: Record<string, string | boolean | undefined>,
  config: ResolvedConfig
): Promise<number> {
  const invalidateCache = (cleanOptions: CliOptions): number | undefined => {
    const invalidateRun = optionString(cleanOptions, "invalidate-run", "");
    if (!invalidateRun) return undefined;

    console.log(`Invalidating run: ${invalidateRun}`);
    const cacheDir = ".cache/extraction";
    if (existsSync(cacheDir)) {
      // Run-specific invalidation is not yet implemented, so we require --yes to clear all
      if (optionBool(cleanOptions, "yes")) {
        console.log(`Clearing ALL evaluation cache in: ${cacheDir}`);
        rmSync(cacheDir, { recursive: true, force: true });
      } else {
        console.error("Error: --invalidate-run currently clears the entire evaluation cache.");
        console.error("Please provide --yes to confirm you want to delete all cached extractions and scores.");
        return 1;
      }
    } else {
      console.log("No cache directory found to invalidate.");
    }
    return 0;
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
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  };

  const writeReports = (report: MatrixReport, outputDir: string, format: string) => {
    mkdirSync(outputDir, { recursive: true });

    if (format === "both" || format === "json") {
      const jsonPath = join(outputDir, "latest.json");
      writeFileSync(jsonPath, exportMatrixJson(report, { pretty: true }));
      console.log(`Wrote JSON report to ${jsonPath}`);
    }

    if (format === "both" || format === "md") {
      const mdPath = join(outputDir, "latest.md");
      writeFileSync(mdPath, renderMatrixReport(report));
      console.log(`Wrote Markdown report to ${mdPath}`);
    }
  };

  try {
    const mode = positionals[1]; // matrix
    if (mode !== "matrix") {
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

    const dryRun = optionBool(cleanOptions, "dry-run");
    const corpusPath = optionString(cleanOptions, "corpus", "");
    const transcriptDir = optionString(cleanOptions, "transcript-dir", "out/eval-matrix/transcripts");
    const modelsStr = optionString(cleanOptions, "models", "");
    const tier = optionString(cleanOptions, "tier", "");
    const judgeModelsStr = optionString(cleanOptions, "judge-models", "gpt-4o");
    const variantsStr = optionString(cleanOptions, "variants", "raw,editorial-pass-v1");
    const outputDir = optionString(cleanOptions, "output-dir", "out/eval-matrix/reports");
    const format = optionString(cleanOptions, "format", "both");
    const resume = optionBool(cleanOptions, "resume");
    const maxConcurrency = optionNumber(cleanOptions, "max-concurrency", 1);
    const extractionMaxTokens = optionNumber(cleanOptions, "extraction-max-tokens", 0) || undefined;
    const extractionMaxChunks = optionNumber(cleanOptions, "extraction-max-chunks", 0) || undefined;
    const judgeMaxTokens = optionNumber(cleanOptions, "judge-max-tokens", 4000);
    const timeoutMs = optionNumber(cleanOptions, "timeout-ms", 60000);

    if (!["both", "json", "md"].includes(format)) {
      console.error(`Invalid format: ${format}. Must be one of: both, json, md`);
      return 1;
    }

    if (!corpusPath) {
      console.error("Error: --corpus <path> is required.");
      return 1;
    }

    const models = getModelsFromIdsOrTier(modelsStr, tier);
    if (typeof models === "number") return models;

    const judgeModels = judgeModelsStr.split(",").map(s => s.trim()).filter(Boolean);
    const variantIds = variantsStr.split(",").map(s => s.trim()).filter(Boolean);

    const invalidVariants = variantIds.filter(v => !isValidVariant(v));
    if (invalidVariants.length > 0) {
      console.error(`Invalid variants provided: ${invalidVariants.join(", ")}`);
      console.error(`Valid variants: ${EXTRACTOR_VARIANTS.join(", ")}`);
      return 1;
    }

    console.log(`Evaluation Matrix Plan:
  Corpus: ${corpusPath}
  Models: ${models.map(m => m.id).join(", ")}
  Tier: ${tier || 'all'}
  Judge Models: ${judgeModels.join(", ")}
  Variants: ${variantIds.join(", ")}
  Output Dir: ${outputDir}
  Format: ${format}
  Resume: ${resume}
  Max Concurrency: ${maxConcurrency}
  Extraction Max Tokens: ${extractionMaxTokens || 'default'}
  Extraction Max Chunks: ${extractionMaxChunks || 'default'}
  Judge Max Tokens: ${judgeMaxTokens}
  Timeout: ${timeoutMs}ms
  `);

    console.log("Running matrix evaluation...");

    const corpusResult = loadCorpusData(corpusPath);
    if (!corpusResult.ok || !corpusResult.data) return corpusResult.error ?? 1;
    const corpusData = corpusResult.data;

    const matrixOptions: MatrixOptions = {
      outputDir,
      cacheDir: ".cache/extraction",
      transcriptDir,
      resume,
      dryRun,
      variants: variantIds as any[],
      judgeModels,
      maxConcurrency,
      timeoutMs,
      extractionMaxTokens,
      extractionMaxChunks,
      judgeMaxTokens,
      extractorClientFactory: (modelId: string) => {
        return createProviderAwareClient(modelId, config.llm);
      },
      judgeClientFactory: (modelId: string) => {
        return createProviderAwareClient(modelId, config.llm);
      }
    };

    const result = await runEvaluationMatrix(corpusData, models, matrixOptions);

    let totalExtractionUsd = 0;
    let totalJudgeUsd = 0;
    for (const cell of result.cells) {
      if (cell.costEstimate) {
        totalExtractionUsd += cell.costEstimate.extractionUsd;
        totalJudgeUsd += cell.costEstimate.judgeUsd;
      }
    }
    const totalUsd = totalExtractionUsd + totalJudgeUsd;

    if (dryRun || totalUsd > 0) {
      console.log("\nEstimated Cost Summary:");
      console.log(`  Extraction: $${totalExtractionUsd.toFixed(4)}`);
      console.log(`  Judge:      $${totalJudgeUsd.toFixed(4)}`);
      console.log(`  Total:      $${totalUsd.toFixed(4)}`);

      const BUDGET_CEILING = 25.00; // $25.00 as per Task 004 full-matrix budget
      if (totalUsd > BUDGET_CEILING) {
         console.warn(`\nWARNING: Estimated cost ($${totalUsd.toFixed(4)}) exceeds Task 004 full-matrix budget ceiling ($${BUDGET_CEILING.toFixed(2)}).`);
      }
    }

    if (dryRun) {
      console.log("Dry run complete. No real LLM calls were made.");
      if (result.metadata.failedCellCount > 0) {
        console.warn(`Dry run detected ${result.metadata.failedCellCount} failed cells (e.g. missing transcripts). Resolve before a real run.`);
        return 1;
      }
      return 0;
    }

    const report = aggregateMatrixResults(result.cells);
    writeReports(report, outputDir, format);

    if (result.metadata.failedCellCount > 0) {
      console.warn(`Evaluation completed with ${result.metadata.failedCellCount} failed cells.`);
      return 1;
    }

    return 0;
  } catch (error) {
    console.error("Evaluation failed:", error);
    return 1;
  }
}
