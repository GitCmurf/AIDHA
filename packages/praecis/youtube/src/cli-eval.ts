import type { ResolvedConfig } from "@aidha/config";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runEvaluationMatrix, type MatrixOptions } from "./eval/matrix-runner.js";
import { getModel, MODEL_REGISTRY } from "./eval/model-registry.js";
import { aggregateMatrixResults } from "./eval/matrix-aggregator.js";
import { renderMatrixReport } from "./eval/report-markdown.js";
import { exportMatrixJson } from "./eval/report-json.js";
import { EXTRACTOR_VARIANTS, isValidVariant } from "./eval/extractor-variants.js";
import { createLlmClientFromConfig } from "./extract/llm-client.js";
import { optionString, optionBool, optionNumber, type CliOptions } from "./cli.js";
import { CorpusSchema } from "./eval/corpus-schema.js";

async function invalidateCache(cleanOptions: CliOptions): Promise<number | undefined> {
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
}

function loadCorpus(corpusPath: string) {
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
}

export async function runEvalMatrix(
  positionals: string[],
  options: Record<string, string | boolean | undefined>,
  config: ResolvedConfig
): Promise<number> {
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

    const cacheInvalidationResult = await invalidateCache(cleanOptions);
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

    if (!["both", "json", "md"].includes(format)) {
      console.error(`Invalid format: ${format}. Must be one of: both, json, md`);
      return 1;
    }

    if (!corpusPath) {
      console.error("Error: --corpus <path> is required.");
      return 1;
    }

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
      // Default to gpt-4o-mini if nothing specified
      modelIds = ["gpt-4o-mini"];
    }

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
  Models: ${modelIds.join(", ")}
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
  `);

    console.log("Running matrix evaluation...");

    const corpusResult = loadCorpus(corpusPath);
    if (!corpusResult.ok) return corpusResult.error!;
    const corpusData = corpusResult.data!;

    const models = modelIds.map(id => {
      const model = getModel(id);
      if (!model) {
        throw new Error(`Model ${id} not found in registry`);
      }
      return model;
    });

    const matrixOptions: MatrixOptions = {
      outputDir,
      cacheDir: ".cache/extraction",
      transcriptDir,
      resume,
      dryRun,
      variants: variantIds as any[],
      judgeModels,
      maxConcurrency,
      timeoutMs: 60000,
      extractionMaxTokens,
      extractionMaxChunks,
      judgeMaxTokens,
      extractorClientFactory: (_modelId: string) => {
        // TODO: route to per-model config once multi-provider support lands;
        // for now all models share config.llm which only supports one provider at a time
        const clientResult = createLlmClientFromConfig(config.llm);
        if (!clientResult.ok) throw clientResult.error;
        return clientResult.value;
      },
      judgeClientFactory: (_modelId: string) => {
        // TODO: route to per-model config once multi-provider support lands
        const clientResult = createLlmClientFromConfig(config.llm);
        if (!clientResult.ok) throw clientResult.error;
        return clientResult.value;
      }
    };

    const result = await runEvaluationMatrix(corpusData, models, matrixOptions);

    if (dryRun) {
      console.log("Dry run complete. No real LLM calls were made.");
      return 0;
    }

    const report = aggregateMatrixResults(result.cells);

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
