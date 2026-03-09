import type { ResolvedConfig } from "@aidha/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { runEvaluationMatrix, type MatrixOptions } from "./eval/matrix-runner.js";
import { getModel } from "./eval/model-registry.js";
import { aggregateMatrixResults } from "./eval/matrix-aggregator.js";
import { renderMatrixReport } from "./eval/report-markdown.js";
import { exportMatrixJson } from "./eval/report-json.js";
import { EXTRACTOR_VARIANTS, isValidVariant } from "./eval/extractor-variants.js";
import { createLlmClientFromConfig } from "./extract/llm-client.js";

type CliOptions = Record<string, string | boolean>;

function optionString(options: CliOptions, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function optionNumber(options: CliOptions, key: string, fallback: number): number {
  const value = options[key];
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return typeof value === 'number' ? value : fallback;
}

function optionBool(options: CliOptions, key: string): boolean {
  const value = options[key];
  return value === true || value === 'true';
}

export async function runEvalMatrix(
  positionals: string[],
  options: Record<string, string | boolean | undefined>,
  config: ResolvedConfig
): Promise<number> {
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

  const dryRun = optionBool(cleanOptions, "dry-run");
  const invalidateRun = optionString(cleanOptions, "invalidate-run", "");

  if (invalidateRun) {
    console.log(`Invalidating run: ${invalidateRun}`);
    // Implementation for invalidate-run (currently a placeholder as per initial spec)
    return 0;
  }

  const corpusPath = optionString(cleanOptions, "corpus", "packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json");
  const modelsStr = optionString(cleanOptions, "models", "gpt-4o-mini");
  const tier = optionString(cleanOptions, "tier", "");
  const judgeModelsStr = optionString(cleanOptions, "judge-models", "gpt-4o");
  const variantsStr = optionString(cleanOptions, "variants", "raw,editorial-pass-v1");
  const outputDir = optionString(cleanOptions, "output-dir", "out/eval-matrix/reports");
  const format = optionString(cleanOptions, "format", "both");
  const resume = optionBool(cleanOptions, "resume");
  const maxConcurrency = optionNumber(cleanOptions, "max-concurrency", 1);

  const modelIds = modelsStr.split(",").map(s => s.trim()).filter(Boolean);
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
  `);

  if (dryRun) {
    console.log("Dry run. Exiting.");
    return 0;
  }

  console.log("Running matrix evaluation...");

  let corpusData;
  try {
    corpusData = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to read corpus file at ${corpusPath}:`, err);
    return 1;
  }

  const models = modelIds.map(id => {
    const m = getModel(id);
    if (!m) {
      throw new Error(`Model ${id} not found in registry`);
    }
    return m;
  });

  const matrixOptions: MatrixOptions = {
    outputDir,
    cacheDir: ".cache/extraction",
    transcriptDir: "out/eval-matrix/transcripts",
    resume,
    dryRun,
    variants: variantIds as any[],
    judgeModels,
    maxConcurrency,
    timeoutMs: 60000,
    extractorClientFactory: (modelId: string) => {
      const clientResult = createLlmClientFromConfig(config.llm);
      if (!clientResult.ok) throw clientResult.error;
      return clientResult.value;
    },
    judgeClientFactory: (modelId: string) => {
      const clientResult = createLlmClientFromConfig(config.llm);
      if (!clientResult.ok) throw clientResult.error;
      return clientResult.value;
    }
  };

  const result = await runEvaluationMatrix(corpusData, models, matrixOptions);
  const report = aggregateMatrixResults(result.cells);

  fs.mkdirSync(outputDir, { recursive: true });

  if (format === "both" || format === "json") {
    const jsonPath = path.join(outputDir, "latest.json");
    fs.writeFileSync(jsonPath, exportMatrixJson(report, { pretty: true }));
    console.log(`Wrote JSON report to ${jsonPath}`);
  }

  if (format === "both" || format === "md") {
    const mdPath = path.join(outputDir, "latest.md");
    fs.writeFileSync(mdPath, renderMatrixReport(report));
    console.log(`Wrote Markdown report to ${mdPath}`);
  }

  return 0;
}
