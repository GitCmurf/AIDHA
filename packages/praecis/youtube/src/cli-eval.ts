import type { ResolvedConfig } from "@aidha/config";
import { optionString, optionBool, optionNumber } from "./cli.js";

// Minimal definition to match cli.ts CliOptions without importing it if it's not exported
type CliOptions = Record<string, string | boolean>;

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
    // Implementation for invalidate-run
    return 0;
  }

  const corpus = optionString(cleanOptions, "corpus", "packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json");
  const models = optionString(cleanOptions, "models", "gpt-4o-mini").split(",");
  const tier = optionString(cleanOptions, "tier", "");
  const judgeModels = optionString(cleanOptions, "judge-models", "gpt-4o").split(",");
  const variants = optionString(cleanOptions, "variants", "raw,editorial-pass-v1").split(",");
  const outputDir = optionString(cleanOptions, "output-dir", "out/eval-matrix/reports");
  const format = optionString(cleanOptions, "format", "both");
  const resume = optionBool(cleanOptions, "resume");
  const maxConcurrency = optionNumber(cleanOptions, "max-concurrency", 1);

  console.log(`Evaluation Matrix Plan:
  Corpus: ${corpus}
  Models: ${models.join(", ")}
  Judge Models: ${judgeModels.join(", ")}
  Variants: ${variants.join(", ")}
  Output Dir: ${outputDir}
  `);

  if (dryRun) {
    console.log("Dry run. Exiting.");
    return 0;
  }

  console.log("Running matrix... (mock implementation)");
  // TODO: call runEvaluationMatrix, aggregate, export

  return 0;
}
