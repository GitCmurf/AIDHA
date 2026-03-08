---
document_id: AIDHA-TASK-004
owner: Ingestion Engineering Lead
status: Draft
version: "0.6"
last_updated: 2026-03-03
title: Claim Extraction Evaluation Matrix
type: TASK
docops_version: "2.0"
---

<!-- markdownlint-disable MD013 MD031 -->
<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-004
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-03-03
> **Type:** TASK

# Claim Extraction Evaluation Matrix

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | ------ | --------------------- |
| 0.1     | 2026-03-02 | AI-assisted | Initial atomic task breakdown                                   | —         | Draft  | AIDHA-TASK-003-ATOMIC |
| 0.2     | 2026-03-03 | AI-assisted | Add independent manual baseline + rubric/fixture best practices | —         | Draft  | AIDHA-TASK-003-ATOMIC |
| 0.3     | 2026-03-03 | AI-assisted | Add calibration loop, type contracts, CI smoke gating, and governance notes | — | Draft | AIDHA-TASK-003-ATOMIC |
| 0.4     | 2026-03-03 | AI-assisted | Tighten type contracts and aggregator/report specs | — | Draft | AIDHA-TASK-003-ATOMIC |
| 0.5     | 2026-03-03 | AI-assisted | Add extraction retry semantics, logging, token/chunk ablations, and JSON-mode prerequisites | — | Draft | AIDHA-TASK-003-ATOMIC |
| 0.6     | 2026-03-03 | AI-assisted | Add tier filtering and extraction-vs-judge cost breakdown | — | Draft | AIDHA-TASK-003-ATOMIC |

## Overview

This task defines a systematic evaluation framework for YouTube claim extraction quality. The framework runs a **matrix** of **5–10 YouTube videos × ~10 LLM models**, then uses **LLM-as-judge** scoring to evaluate each extraction run across four quality dimensions:

| Dimension          | Definition                                                                                                  |
| :----------------- | :---------------------------------------------------------------------------------------------------------- |
| **Completeness**   | Does the extraction capture all substantive claims present in the transcript? (Recall proxy)                |
| **Accuracy**       | Are extracted claims faithful to the source material without hallucination or distortion? (Precision proxy) |
| **Topic Coverage** | Do the claims proportionally cover the video's topic distribution and timeline? (Representativeness proxy)  |
| **Atomicity**      | Are claims single, indivisible assertions without redundancy? (Structure proxy)                             |

### Goals

- Establish a repeatable benchmark to compare extraction quality across models (and model versions).
- Detect regressions in extraction quality (and/or editorial second-pass filtering) before merge.
- Produce actionable diagnostics (missing claims, hallucinations, redundancy patterns, gap areas) so fixes are targeted.

### Non-Goals

- Proving claims are true in the real world (fact-checking against external sources is out of scope).
- Building a perfect recall/precision ground truth for all corpus videos (we calibrate against a small Golden Set; the rest is proxy scoring).

### Definitions (Operational)

- **Claim**: A standalone, falsifiable assertion attributable to the video content (not to outside knowledge).
- **Substantive claim**: Non-trivial statements that change a reader’s beliefs/actions (exclude greetings, ads, housekeeping, “subscribe”, etc.).
- **Atomic claim**: One indivisible assertion. If it contains “and/or” with multiple assertions, it should be split.
- **Harness**: The in-repo extraction pipeline + prompts + post-processing (including any editorial second pass).
- **Manual baseline (no harness)**: A direct prompt-response extraction using an external UI (Gemini web / ChatGPT UI) to sanity-check what content is extractable independent of our harness and model wrappers.

### Anchored Scoring Guidance (0–10)

These anchors are for humans and the judge prompt so scores are comparable over time.

- **Completeness**
  - `0`: Misses almost all substantive claims; only captures a few obvious points.
  - `5`: Captures main claims but misses many secondary claims and/or entire segments.
  - `10`: Captures essentially all substantive claims; misses (at most) minor details.
- **Accuracy**
  - `0`: Many hallucinations, distortions, wrong attributions, or invented numbers.
  - `5`: Mostly faithful but with several distortions/over-generalizations.
  - `10`: Faithful paraphrases with no hallucinations; qualifies uncertainty appropriately.
- **Topic Coverage**
  - `0`: Mostly one topic while ignoring large parts of the video, or heavily front-loaded.
  - `5`: Covers major topics but under-represents some segments/topics.
  - `10`: Proportional coverage across the full timeline and topic distribution.
- **Atomicity**
  - `0`: Mostly multi-claim sentences, duplicates, and merged ideas.
  - `5`: Mixed: many atomic claims, but frequent redundancy or multi-claim items.
  - `10`: Nearly all claims are atomic, non-redundant, and consistently formatted.

### Expected Outputs (Artifacts)

- **Cell-level extraction output**: per `(videoId, modelId, extractorVariant)` a structured claim set plus prompt/response trace.
- **Cell-level scoring output**: per `(videoId, modelId, extractorVariant, judgeModelId)` a validated `ClaimSetScore` plus trace.
- **Reports**: markdown for human review; JSON for programmatic trend/CI gating.
- **Manual baseline snapshots**: captured prompts + responses for a small subset, plus a short comparison write-up of systematic deltas vs harness (especially editorial second pass).

### Design Principles (per `engineering-principles.md`)

- **Separation of concerns**: extraction, scoring, and reporting are distinct modules
- **Determinism**: all tests reproducible without live API calls (cached transcripts + recorded LLM responses)
- **Validate at the boundary**: LLM judge responses validated via zod schema before aggregation
- **Fail explicitly**: scoring failures produce structured error context, not silent zeros
- **Test-first**: each module begins with a failing test before implementation
- **Internal schemas (pre-v1.0)**: Matrix report/output schemas are internal and may change freely until a v1.0 contract is declared.

### Constraints & Risks (Call Out Early)

- **Copyright / licensing**: do not commit full copyrighted transcripts to the public repo. Prefer:
  - Synthetic transcripts for CI tests.
  - Short excerpts only when clearly defensible.
  - Local-only caches for full real transcripts (gitignored, outside `tests/fixtures/`).
- **Context window**: judges cannot always see a 2hr transcript; plan for chunked / sampled scoring where needed.
- **Judge bias**: LLM-as-judge can drift; calibrate on Golden Set and use multi-judge consensus + variance flags.
- **Cost**: matrix runs can be expensive; dry-run planning and caching are mandatory.
- **Budget ceiling**: default ceiling for a “full matrix” run is `$25` estimated cost. Runs above this should require manual approval. (`--dry-run` must print estimated cost before execution.)
- **Prompt injection (transcript content)**: transcripts may contain adversarial text. Judge prompts should wrap transcript in clear delimiters and instruct the judge to treat transcript text as data, not instructions.
- **Rollback/recovery**: define how to invalidate a bad run/cell cache without deleting unrelated cache entries.

### Dependency

This task depends on AIDHA-TASK-003-ATOMIC delivering (minimum):

- A stable `ClaimCandidate` shape and extraction pipeline outputs we can score deterministically.
- Prompt/version metadata needed for cache keys (`promptVersion`, `extractorVersion`, and editor version/variant identifiers).
- Editorial second-pass implementations (AIDHA-PLAN-004) that can be toggled for ablation as `extractorVariantId` values.

Non-blocking: any optional heuristic enrichment work in AIDHA-TASK-003-ATOMIC that does not change the evaluation harness contract.

## Acceptance Criteria

1. No existing tests - validation defined in [Phase 4: Validation & CI Integration](#phase-4-validation--ci-integration) and references Phase 4 test tasks (4.1-4.6).
2. Document-level artifacts defined:
   - Cell-level extraction output
   - Cell-level scoring output / ClaimSetScore
   - Aggregated Reports

---

## Phase 1: Test Corpus & Infrastructure

### Task 1.1: Curate evaluation video corpus

- [ ] **Task**: Create [`packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json`] defining 5–10 YouTube video entries with fields: `videoId`, `url`, `title`, `channelName`, `durationMinutes`, `topicDomain`, `expectedClaimDensity` (low/medium/high), `language`, `captionSource` (manual/auto/unknown), `speakerStyle` (solo/interview/panel/unknown), `rationale`
- **Rationale**: A diverse corpus spanning different content types (lecture, interview, panel, solo explainer), durations (15min–2hr+), and domains (nutrition, neuroscience, exercise physiology) prevents overfitting evaluation to a single video style. The existing test video `h_1zlead9ZU` (Huberman × Aragon, ~2hr, nutrition) is necessary but insufficient alone.
- **Selection Criteria**: At least 2 videos per domain category; at least 1 video <30min and 1 video >90min; at least 1 multi-speaker panel; no duplicate channels; at least 1 video with notably noisy captions (to test robustness to transcript quality)
- **Regression Guard**: Corpus file validated by schema test; minimum 5 entries enforced
- **Completion Criteria**: Corpus JSON passes schema validation; each entry includes rationale for inclusion; corpus covers ≥3 distinct topic domains
- **Spec Example**:
  ```json
  {
    "videoId": "h_1zlead9ZU",
    "url": "https://www.youtube.com/watch?v=h_1zlead9ZU",
    "title": "Dr. Andrew Huberman: The Science of Nutrition...",
    "channelName": "Huberman Lab",
    "durationMinutes": 124,
    "topicDomain": "Nutrition",
    "expectedClaimDensity": "high",
    "rationale": "High-density scientific assertions; multi-speaker debate."
  }
  ```

### Task 1.1b: Validate corpus schema (zod + test)

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/corpus-schema.ts`] exporting a zod schema for `CorpusEntry`
- [ ] **Task**: Create [`packages/praecis/youtube/tests/eval/corpus-schema.test.ts`] validating `corpus.json` against the schema
- **Rationale**: The corpus file is a core input contract; schema validation prevents accidental drift and confusing runtime failures.
- **Regression Guard**: Schema test runs in CI; invalid/missing fields fail fast with clear output
- **Completion Criteria**: `corpus.json` validation runs in CI and fails on invalid entries

### Task 1.2: Ingest and cache transcripts for corpus videos

- [ ] **Task**: Create script [`scripts/eval-matrix/ingest-corpus.sh`] that runs `pnpm -C packages/praecis/youtube cli ingest video <url>` for each corpus entry and writes transcript JSON to a **local-only cache** directory (gitignored), e.g. `out/eval-matrix/transcripts/<videoId>.json`
- [ ] **Task**: Create a small committed fixture set [`packages/praecis/youtube/tests/fixtures/eval-matrix/transcript-excerpts/`] containing:
  - synthetic transcripts for deterministic unit/integration tests, and/or
  - short excerpt transcripts (seconds/minutes, not hours) when clearly defensible
- **Rationale**: Determinism matters, but committing full YouTube transcripts is likely a licensing/copyright risk for a public repo. Separate **local evaluation corpora** from **committed CI fixtures** so engineering discipline does not force risky content into git.
- **Regression Guard**: Script is idempotent; skips already-cached transcripts; validates transcript non-empty; fails loudly when cache dir is missing/unwritable
- **Completion Criteria**: Corpus ingestion populates local cache; CI tests run using only committed excerpts/synthetic fixtures; repo `.gitignore` prevents accidental transcript commits

### Task 1.3: Define model registry

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/model-registry.ts`] exporting `EvalModel[]` with fields: `id`, `provider`, `baseUrl`, `modelName`, `contextWindow`, `supportsJsonMode`, `costPer1kTokens`, `notes`, `tier` (`frontier|midtier|budget`), `availability` (`stable|experimental|free-tier`)
- **Rationale**: Centralised model metadata enables cost estimation, capability gating (e.g., JSON mode), and reporting. Avoids stringly-typed model references scattered across scripts.
- **Model Candidates**: GPT-5, GPT-5-mini, Claude Opus 4, Claude Sonnet 4, Gemini 2.5 Pro, Gemini 2.5 Flash, Llama 4 Maverick, Llama 4 Scout, DeepSeek-R1, Qwen 3 235B
- **Regression Guard**: Registry validated by unit test; each entry requires non-empty `id` and `provider`
- **Execution Guidance**: Start with ≤4 models for the first baseline run (cost/benefit), then expand toward ~10 once the harness and judge calibration are stable.
- **Selection Guidance**: For the initial ≤4 models, prefer one ceiling (frontier), one likely production default (midtier), one cost floor (budget), and one long-context specialist. Keep “free-tier/experimental gateway” models optional because availability and behavior can change.
- **Completion Criteria**: Registry contains ≥8 models across ≥3 providers; TypeScript types exported; unit test validates schema

### Task 1.4: Implement matrix runner orchestrator

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/matrix-runner.ts`] with `runEvaluationMatrix(corpus: CorpusEntry[], models: EvalModel[], options: MatrixOptions): Promise<MatrixResult>` that iterates video × model combinations, invokes extraction, and collects raw claim sets
- **Rationale**: Orchestrator separates extraction execution from scoring (separation of concerns). Supports partial runs, resume-on-failure, and parallel execution per model. It must also support **pipeline variants** so we can measure deltas (e.g., editorial second pass on/off).
- **Variant Requirement**: Matrix keys include an `extractorVariantId` (e.g., `raw`, `editorial-pass-v1`, `editorial-pass-v2`) so we can run ablations without changing model IDs.
- **Contract Requirement**: Define (and export) the core eval types so downstream modules are not guesswork:
  - `ExtractorVariantId`
  - `VideoContext` (explicitly what judge sees)
  - `MatrixOptions`
  - `MatrixCell`
- **Spec Definition (Minimum)**
  ```typescript
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
    // Optional evaluation-only overrides to avoid silent truncation/drops.
    extractionMaxTokens?: number;
    extractionMaxChunks?: number;
  }

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

  export type ScoreDimension =
    | "completeness"
    | "accuracy"
    | "topicCoverage"
    | "atomicity"
    | "overallScore";

  export interface MatrixResult {
    cells: MatrixCell[];
    metadata: {
      startedAt: string;
      completedAt?: string;
      config: MatrixOptions;
      failedCellCount: number;
    };
  }
  ```
- **Failure Semantics**: For any cell that still fails after extraction retries, record a structured `error` on that `MatrixCell` and continue the run (do not abort the entire matrix by default).
- **Logging Requirement**: Emit structured progress logs so long runs are readable:
  - Example: `[cell 12/60] videoId=h_1zlead9ZU modelId=gpt-5-mini variant=raw status=ok durationMs=53210`
- **Regression Guard**: Each run produces a deterministic output keyed by `videoId + modelId + extractorVariantId + promptVersion`; results cached to `out/eval-matrix/runs/`; raw prompt/response traces stored per cell for debugging
- **Completion Criteria**: Orchestrator completes a 2-video × 2-model × 2-variant matrix in <10 minutes using cached transcripts; outputs structured JSON per cell

### Task 1.4b: Make extractor variants non-stringly-typed

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/extractor-variants.ts`] exporting `ExtractorVariantId` and a registry of supported variants (initial: `raw`, `editorial-pass-v1`, `editorial-pass-v2`)
- **Rationale**: Variants are a first-class experimental axis; a registry prevents silent typos and makes reports consistent.
- **Regression Guard**: Matrix runner validates requested variants against the registry before executing
- **Completion Criteria**: Invalid variant IDs fail fast with a clear error; CLI `--variants` flag (Task 3.4) is validated against the registry
  - **Optional Variant**: Add `single-pass` for models whose `contextWindow` can handle the full transcript and prompt overhead, to compare chunk-and-merge vs full-context extraction.

### Task 1.5: Add matrix result caching layer

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/matrix-cache.ts`] implementing read/write for matrix cell results keyed by `sha256(videoId + modelId + extractorVariantId + promptVersion + extractorVersion)`
- **Rationale**: LLM extraction is expensive (~$0.01–0.50 per video×model cell). Caching prevents re-extraction when only scoring logic changes. Cache invalidation on prompt/extractor version change ensures freshness.
- **Regression Guard**: Cache miss triggers extraction; cache hit skips extraction and logs cache-hit; stale cache detected by version mismatch. If `extractorVersion` is unavailable, fall back to `unknown-v0` (but emit a warning).
- **Completion Criteria**: Second run of identical matrix completes in <5 seconds; version bump triggers full re-extraction

### Task 1.6: Create human-verified golden annotations

- [ ] **Task**: Create [`packages/praecis/youtube/tests/fixtures/eval-matrix/golden-annotations.json`] containing human-verified "ideal" claim sets for 2 representative videos from the corpus (one short, one long)
- [ ] **Task**: Define schema for annotations: `videoId`, `idealClaims: { text: string, evidence?: { quote?: string, startMs?: number, endMs?: number } }[]`, `rejectedClaims: { text: string, reason: string }[]`
- **Rationale**: To trust the "LLM-as-Judge", we must calibrate it against human judgment. This "Golden Set" serves as the ground truth for validating the scoring engine itself (Task 2.2).
- **Note**: This Golden Set is distinct from the AIDHA-TASK-003-ATOMIC golden extraction fixtures (e.g., `claims-golden.json`). Those protect extraction outputs; this set calibrates the judge/scorer.
- **Annotation Guidance**: Create a short, co-located guideline (`golden-annotations-guidelines.md`) that defines what counts as a substantive claim, how to split atomic claims, and how to handle hedged language.
- **Schema Change (Fixture Shape)**: `GoldenAnnotation.idealClaims` is now an object array (not `string[]`) to allow optional evidence metadata. Any existing `golden-annotations.json` fixtures and any parsing/validation code must migrate.
  - Before:
    ```json
    {
      "videoId": "abc",
      "idealClaims": ["Claim 1", "Claim 2"],
      "rejectedClaims": []
    }
    ```
  - After:
    ```json
    {
      "videoId": "abc",
      "idealClaims": [
        { "text": "Claim 1" },
        {
          "text": "Claim 2",
          "evidence": { "startMs": 123000, "endMs": 129000 }
        }
      ],
      "rejectedClaims": []
    }
    ```
- **Regression Guard**: JSON validated by schema; contains at least 2 videos
- **Spec Definition**:
  ```typescript
  interface GoldenAnnotation {
    videoId: string;
    idealClaims: {
      text: string; // The perfect set of claims a human would extract
      evidence?: { quote?: string; startMs?: number; endMs?: number };
    }[];
    rejectedClaims: {
      text: string;
      reason: "hallucination" | "redundant" | "fragment" | "topic-drift";
    }[];
  }
  ```
- **Completion Criteria**: Fixture file exists and contains manually curated claims for the selected videos

### Task 1.7: Capture independent manual baseline (no harness)

- [ ] **Task**: Create [`docs/55-testing/eval-matrix/manual-baseline-no-harness.md`] describing a manual procedure to extract claims directly via external UIs (Gemini web and/or ChatGPT UI) from a small subset of transcripts
- [ ] **Task**: Create [`packages/praecis/youtube/tests/fixtures/eval-matrix/manual-baseline/`] containing captured prompt/response snapshots for at least:
  - 2 videos (or 1 video with 2 distant segments: early and late)
  - 2 different external UIs/models (e.g., Gemini web and ChatGPT)
  - 2 extraction instructions (“high recall” vs “high precision”) to expose editorial-like filtering behavior
- **Rationale**: This bypasses our harness entirely and answers a key question: “Are we consistently excluding valuable content because of our prompts/post-processing/editorial second pass, independent of model selection and wrappers?”
- **Baseline Protocol (Minimum)**
  - Use the same **committed transcript excerpt** (from Task 1.2) as input (paste into UI), with an explicit “do not use outside knowledge” instruction.
  - Use the lowest-temperature / most-deterministic setting available (or note when the UI does not expose it).
  - Use an identical prompt template per “mode” (high recall / high precision), committed alongside the snapshots (e.g., `manual-baseline/prompt-template-high-recall.md` and `manual-baseline/prompt-template-high-precision.md`).
  - Use a predictable snapshot naming convention, e.g. `{videoId}-{provider}-{mode}.md`.
  - Request atomic claims; ask for a short “what I excluded and why” section.
  - Record: date/time, UI/provider, model name if visible, any toggles (temperature/verbosity), prompt text, raw response.
- **Comparison Questions**
  - Which claim categories are present in the manual baseline but missing in harness output?
  - Do missing categories correlate with editorial second pass filtering rules (e.g., “speculative”, “hedged”, “anecdotal”, “mechanism explanations”)?
  - Are the same categories missing across different external UIs/models (systematic harness issue) or do they vary by model (model capability issue)?
  - For models with very large context windows: does single-context “unfettered” extraction identify cross-segment claims that chunked extraction misses?
- **Regression Guard**: Snapshots stored alongside the excerpt input text used; snapshots are stable and referenced from the write-up
- **Governance**: If any snapshot content is committed and derived from third-party transcript text, register it in AIDHA-GOV-005.
- **Comparison Method**: This comparison is a one-time manual human review step. The write-up should be committed in the same PR as the snapshots it analyzes.
- **Completion Criteria**: Manual baseline doc exists; at least 4 prompt/response snapshots captured; write-up identifies at least 3 concrete “systematic miss” patterns or explicitly states none found

### Task 1.8: Evaluate editorial second pass via ablation (raw vs filtered)

- [ ] **Task**: Define an `extractorVariantId` for “raw” (no editorial pass) and “editorial-pass-v1” (current), and include both in the evaluation matrix runs for at least 2 videos × 3 models
- **Rationale**: This isolates whether the editorial second pass is trading away completeness/topic coverage disproportionately relative to accuracy/atomicity gains.
- **Cross-Reference**: `editorial-pass-v1`/`editorial-pass-v2` should map to the editorial ranking variants described in AIDHA-PLAN-004, so ablations are interpretable.
- **Additivity Check (Silent Loss Risks)**: For at least 1 dense video, include a sensitivity check to detect silent claim loss due to:
  - `maxTokens` truncation (e.g., run extraction with default vs higher `extractionMaxTokens` and compare deltas)
  - `maxChunks` capping (set `extractionMaxChunks` high enough to cover full duration for long videos; document any production caps and expected completeness impact)
- **Regression Guard**: Variant IDs are first-class in cache keys and reports (no accidental overwrites)
- **Completion Criteria**: Report includes a “variant delta” section showing score deltas and qualitative deltas (missingClaims/hallucinations changes) between raw vs editorial-pass-v1

---

## Phase 2: LLM-as-Judge Scoring Engine

### Task 2.1: Define scoring rubric schema

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/scoring-rubric.ts`] exporting zod schemas for `ClaimSetScore` with fields: `completeness: number` (0–10), `accuracy: number` (0–10), `topicCoverage: number` (0–10), `atomicity: number` (0–10), `overallScore: number` (0–10), `reasoning: string`, `missingClaims: { text: string }[]`, `hallucinations: { text: string }[]`, `redundancies: { text: string }[]`, `gapAreas: { area: string }[]`, plus `judgeMeta: { judgeModelId: string, judgePromptVersion: string }`
- **Rationale**: Structured scoring with explicit sub-dimensions prevents vague "good/bad" judgments. Zod validation at the boundary (engineering-principles.md §5) catches malformed judge responses before they corrupt aggregation.
- **Definition**: `overallScore` is the arithmetic mean of `{ completeness, accuracy, topicCoverage, atomicity }` (unweighted). The scoring executor should recompute it from the four dimensions to prevent drift.
- **Cross-Reference**: Reuse `ClaimCandidate` from the extraction pipeline (`packages/praecis/youtube/src/extract/types.ts`). Do not redefine claim shapes in the eval module.
- **Schema Change (Judge Output Shape)**: `ClaimSetScore.missingClaims`, `hallucinations`, `redundancies`, and `gapAreas` are now arrays of objects (not `string[]`). Update any parsers/aggregators and invalidate any cached judge outputs created under older schema versions.
- **Regression Guard**: Schema rejects scores outside 0–10 range; `reasoning` required non-empty; arrays may be empty but must be present
- **Spec Definition**:
  ```typescript
  export const ClaimSetScoreSchema = z.object({
    completeness: z.number().min(0).max(10),
    accuracy: z.number().min(0).max(10),
    topicCoverage: z.number().min(0).max(10),
    atomicity: z.number().min(0).max(10),
    overallScore: z.number().min(0).max(10),
    reasoning: z.string().min(10),
    missingClaims: z.array(z.object({ text: z.string().min(1) })),
    hallucinations: z.array(z.object({ text: z.string().min(1) })),
    redundancies: z.array(z.object({ text: z.string().min(1) })),
    gapAreas: z.array(z.object({ area: z.string().min(1) })),
    judgeMeta: z.object({
      judgeModelId: z.string().min(1),
      judgePromptVersion: z.string().min(1),
    }),
  });
  ```
- **Completion Criteria**: Schema validates example scores; rejects out-of-range values; unit test covers edge cases (0, 10, missing fields)

### Task 2.2: Implement judge prompt template

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/prompts/judge-claim-quality.ts`] exporting `buildJudgePrompt(transcript: string, claims: ClaimCandidate[], videoContext: VideoContext): { system: string; user: string }` that instructs the judge model to evaluate the four dimensions
- **Rationale**: The judge prompt is the most critical component. It must be calibrated against the human-verified Golden Set (Task 1.6) to ensure it penalizes what a human would penalize.
- **Prompt Design**:
  - System: "You are an expert evaluator of information extraction quality..."
  - Include the full transcript (or representative chunks) as ground truth
  - Include the extracted claim set to evaluate
  - Include 2 calibration examples derived from Task 1.6 (Golden Annotations)
  - Request structured JSON output matching `ClaimSetScore` schema
- **Best Practice Requirements**
  - Blind the judge to the extraction model/provider name (avoid “model X produced these”).
  - Randomize claim order (or explicitly instruct the judge not to assume ordering implies importance).
  - For long transcripts: support chunked scoring (e.g., score per excerpt/segment then aggregate) to avoid context-window truncation.
  - Mitigate transcript prompt-injection: wrap transcript content in explicit delimiters (e.g., `<TRANSCRIPT>...</TRANSCRIPT>`) and instruct the judge to ignore any instructions found inside.
- **Prompt Structure Spec**:
  - **System**: "You are an expert evaluator of information extraction quality... Output JSON only."
  - **User**:
    - `TRANSCRIPT_CONTEXT`: (Title, Channel, Description)
    - `TRANSCRIPT_TEXT`: (The text to evaluate against)
    - `CANDIDATE_CLAIMS`: (The JSON list of claims to score)
    - `CALIBRATION_EXAMPLES`: (Array of { claims: [], score: {}, reasoning: "" })
- **Regression Guard**: Prompt template tested for presence of all four dimension names; calibration examples included; output format instruction present
- **Completion Criteria**: Judge prompt produces parseable `ClaimSetScore` JSON from ≥2 different judge models; inter-rater agreement >0.7 on calibration examples

### Task 2.2b: Calibrate judge prompt against Golden Set (iteration loop)

- [ ] **Task**: Define a calibration protocol that runs the judge over Golden Set examples and compares the resulting scores to expected human judgments (from Task 1.6)
- **Rationale**: “Inter-rater agreement >0.7” is only meaningful if we have an explicit loop to iterate prompts (and/or judge model choice) until that target is met or we decide it is infeasible.
- **Acceptance Criteria**: Calibration rounds are recorded (prompt version, judge model, deltas). Calibration is considered “pass” when agreement exceeds threshold for all four dimensions on the Golden Set examples, or a documented decision is made to adjust the threshold and why.

### Task 2.2c: Specify chunked scoring strategy (when transcript exceeds contextWindow)

- [ ] **Task**: Specify and implement a chunking strategy for judge scoring:
  - Partition transcript into segments by token budget (with small overlap).
  - Score per segment, then aggregate to a single `ClaimSetScore`.
  - Define how `missingClaims`/`hallucinations`/`redundancies` union/dedup across segments.
- **Rationale**: Without a specified strategy, “support chunked scoring” becomes an untestable aspiration and long-form videos will behave inconsistently.
- **Gating Rule**: Use full-transcript scoring when `model.contextWindow` comfortably exceeds `transcriptTokenCount + promptOverhead`. Otherwise, chunk deterministically.
- **Regression Guard**: A unit test should cover chunking determinism: same transcript yields same segment boundaries and aggregate score.

### Task 2.3: Implement scoring executor

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/scoring-executor.ts`] with `scoreClaimSet(judgeClient: LlmClient, judgeModel: string, transcript: string, claims: ClaimCandidate[], videoContext: VideoContext): Promise<Result<ClaimSetScore>>` that sends the judge prompt, validates the response, and retries once on parse failure
- **Rationale**: Scoring execution is separated from prompt construction (SRP) and from matrix orchestration. Retry with parse-error feedback (per task-003 Task 2.10 pattern) improves judge response quality.
- **Implementation Note**: Reuse the existing `LlmClient` abstraction from the ingestion/extraction stack where possible; judge model selection is per-call via `judgeModel`. If judges require different provider config or keys, model registry metadata should drive client routing rather than ad-hoc conditionals.
- **Judge Token Budget**: Configure a judge-specific `maxTokens` high enough to avoid truncation of structured diagnostics arrays (recommend starting range `4000–8000`, then tune). Expose as `AIDHA_EVAL_JUDGE_MAX_TOKENS`.
- **JSON Mode Prerequisite**: If `supportsJsonMode` is true for a model, ensure the client can actually request JSON-only output (e.g., OpenAI-compatible `response_format`). If the current `LlmClient` cannot pass this through, add it as a prerequisite task before relying on JSON mode in eval.
- **Regression Guard**: Parse failures logged with raw response for debugging; retry includes validation error in follow-up prompt; timeout configurable via `AIDHA_EVAL_JUDGE_TIMEOUT_MS`
- **Completion Criteria**: Executor returns validated `ClaimSetScore` or structured error; retry success rate >80% on intentionally malformed responses

### Task 2.4 (Optional Enhancement): Implement multi-judge consensus scoring

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/consensus-scorer.ts`] with `scoreWithConsensus(...)` that runs ≥2 judge models (configurable) and computes mean scores with inter-rater variance
- **Rationale**: Single-judge scoring is unreliable due to model-specific biases. Multi-judge consensus with variance reporting surfaces disagreements that indicate ambiguous extraction quality. Engineering-principles.md §8: "Optimise after measuring" — variance data guides judge selection.
- **KISS Default**: Single-judge scoring should be the default path initially; add consensus after Task 2.2b calibration is stable.
- **Consensus Method**: Mean of dimension scores; flag cells where any dimension variance >2.0 for manual review
- **Regression Guard**: Minimum 2 judges required; single-judge fallback emits warning; variance computed per dimension
- **Completion Criteria**: Consensus scorer produces mean + variance for all four dimensions; high-variance cells flagged in output

### Task 2.5: Add judge response caching

- [ ] **Task**: Extend [`packages/praecis/youtube/src/eval/matrix-cache.ts`] to cache judge scores keyed by `sha256(videoId + extractionModelId + judgeModelId + claimSetHash + judgePromptVersion)`
- **Rationale**: Judge calls are as expensive as extraction calls. Caching prevents re-scoring when only reporting changes. Separate cache key from extraction cache ensures judge prompt changes trigger re-scoring without re-extraction.
- **Regression Guard**: Judge prompt version included in cache key; stale scores invalidated on prompt change
- **Completion Criteria**: Re-running scoring on cached extractions completes in <10 seconds; prompt version bump triggers re-scoring

---

## Phase 3: Reporting & Visualisation

### Task 3.1: Implement matrix result aggregator

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/matrix-aggregator.ts`] with `aggregateMatrixResults(cells: MatrixCell[]): MatrixReport` that computes per-model averages, per-video averages, overall rankings, and dimension-specific leaderboards
- **Rationale**: Raw cell scores are not actionable without aggregation. Per-model averages reveal which models extract best; per-video averages reveal which content types are hardest; dimension leaderboards show model strengths (e.g., "Model X is most accurate but least complete").
- **Aggregation Metrics**: mean, median, min, max, stddev per dimension per model; rank ordering by overall score; cost-efficiency ratio (score / cost)
- **Regression Guard**: Aggregator handles missing cells (partial matrix runs) gracefully; empty matrix returns structured error
- **Spec Definition**:
  ```typescript
  type ScoreDimension =
    | "completeness"
    | "accuracy"
    | "topicCoverage"
    | "atomicity"
    | "overallScore";

  type StatName = "mean" | "median" | "min" | "max" | "stddev";

  type DimensionStats = Record<ScoreDimension, Record<StatName, number>>;

  interface MatrixReport {
    summary: { bestModel: string; worstModel: string; hardestVideo: string };
    modelStats: Record<string, { dimensions: DimensionStats; estimatedCostUsd?: number }>;
    videoStats: Record<string, { dimensions: DimensionStats }>;
    leaderboards: Record<ScoreDimension, { modelId: string; score: number }[]>;
  }
  ```
- **Completion Criteria**: Aggregator produces valid report from a 3×3 matrix; rankings are deterministic (tiebreaker by model name)

### Task 3.2: Generate markdown comparison report

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/report-markdown.ts`] with `renderMatrixReport(report: MatrixReport): string` producing a markdown document with: summary table, per-model scorecards, per-video heatmap (using emoji indicators), dimension radar descriptions, cost analysis, and recommendations
- **Rationale**: Markdown output integrates with the existing dossier/docs workflow and is reviewable in PRs. Structured format enables both human review and automated trend detection.
- **Output Structure**:
  - Executive summary (best model, worst model, hardest video)
  - Model × Video score matrix table
  - Per-dimension leaderboard tables
  - Variant delta section (raw vs editorial-pass-v1)
  - Manual baseline delta notes (links to Task 1.7 artifacts)
  - Cost-efficiency analysis
  - Failure analysis (cells scoring <4 on any dimension)
- **Regression Guard**: Report renderer tested with mock data; output validated as parseable markdown
- **Completion Criteria**: Report renders cleanly in MkDocs preview (`pnpm docs:serve`); all sections populated from mock matrix data

### Task 3.3: Generate JSON export for programmatic analysis

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/report-json.ts`] with `exportMatrixJson(report: MatrixReport, options: { pretty?: boolean }): string` producing machine-readable JSON with full cell-level detail
- **Rationale**: JSON export enables downstream tooling (dashboards, trend analysis, CI integration) without coupling to markdown rendering. Engineering-principles.md §2: separation of concerns between human-readable and machine-readable outputs.
- **Regression Guard**: JSON output validated against zod schema; round-trip test (export → parse → re-export) produces identical output
- **Completion Criteria**: JSON export includes all cell scores, aggregations, and metadata; file size <1MB for a 10×10 matrix

### Task 3.4: Add CLI command for evaluation matrix

- [ ] **Task**: Add `eval matrix` subcommand to [`packages/praecis/youtube/src/cli.ts`] with flags: `--corpus <path>`, `--models <comma-separated>`, `--tier <frontier|midtier|budget>`, `--judge-models <comma-separated>`, `--variants <comma-separated>`, `--output-dir <path>`, `--format <md|json|both>`, `--resume` (skip cached cells), `--dry-run` (show matrix plan without execution), `--max-concurrency <n>`, `--invalidate-run <runId>`
- **Rationale**: CLI integration enables both interactive use and CI automation. `--dry-run` prevents accidental expensive runs; `--resume` enables incremental matrix completion.
- **Regression Guard**: CLI help text updated; `--dry-run` produces no LLM calls; unknown flags produce clear error
- **Completion Criteria**: `pnpm -C packages/praecis/youtube cli eval matrix --dry-run --corpus <path>` outputs planned matrix dimensions without API calls; `--help` documents all flags

### Task 3.5: Implement run/cell invalidation (rollback tool)

- [ ] **Task**: Implement `--invalidate-run <runId>` to remove only the cache entries for a specific run (extraction + judge caches), without deleting unrelated caches
- **Rationale**: When a run is clearly corrupted (bad prompt version, partial failure, wrong config), we need a safe recovery mechanism that does not require manual filesystem surgery.
- **Regression Guard**: Invalidation prints exactly what it will delete (dry-run supported) and refuses to delete paths outside the expected cache roots
- **Completion Criteria**: A run can be invalidated and then re-run cleanly with fresh outputs, while other runs remain cached

---

## Phase 4: Validation & CI Integration

### Task 4.1: Create unit tests for scoring rubric

- [ ] **Task**: Create [`packages/praecis/youtube/tests/eval/scoring-rubric.test.ts`] testing zod schema validation for valid scores, boundary values, out-of-range rejection, missing required fields, and empty arrays
- **Rationale**: Test-first (engineering-principles.md §4). Scoring schema is the contract between judge LLM output and aggregation logic — schema bugs silently corrupt all downstream metrics.
- **Regression Guard**: Tests run in CI without LLM dependency; pure schema validation
- **Completion Criteria**: ≥10 test cases covering valid, invalid, and edge-case score payloads

### Task 4.2: Create unit tests for judge prompt template

- [ ] **Task**: Create [`packages/praecis/youtube/tests/eval/judge-prompt.test.ts`] asserting: prompt contains all four dimension names, includes calibration examples, requests JSON output, includes transcript content, includes claim set
- **Rationale**: Prompt contract tests (per task-003 Phase 2 pattern) prevent silent prompt regression that degrades judge quality without visible code changes.
- **Regression Guard**: Tests are deterministic; no LLM calls; string assertion only
- **Completion Criteria**: Tests fail if any dimension name removed from prompt; tests fail if calibration examples removed

### Task 4.3: Create integration test for matrix runner with mock LLM

- [ ] **Task**: Create [`packages/praecis/youtube/tests/eval/matrix-runner.test.ts`] running a 2-video × 2-model matrix with mock LLM client returning recorded responses, asserting: all cells populated, scores within valid range, cache populated, report generated
- **Rationale**: Integration test validates the full pipeline (extraction → scoring → aggregation → reporting) without live API calls. Engineering-principles.md §4: "Test pyramid — use integration tests for boundaries."
- **Regression Guard**: Mock LLM responses recorded from actual runs; deterministic replay
- **Completion Criteria**: Test completes in <30 seconds; all matrix cells contain valid scores; report markdown renders without errors

### Task 4.4: Add CI quality gate for extraction regression

- [ ] **Task**: Create [`packages/praecis/youtube/tests/eval/quality-gate.spec.ts`] that loads the latest matrix report JSON and asserts either:
  - absolute minimums (initial bootstrap), and/or
  - **no-regression vs a pinned baseline report** (preferred once baseline exists)
- **Rationale**: Absolute thresholds tend to be brittle (corpus changes, judge drift). A pinned baseline with “no regression beyond delta” is usually the more stable CI signal.
- **Regression Guard**: Gate reads from cached report; does not trigger new extraction; thresholds configurable via environment variables
- **CI-Safe Mode Requirement**: CI must not run a full live matrix. Use a 2-video × 2-model smoke matrix with recorded/mock responses (Task 4.3) and compare against a pinned baseline report fixture (e.g., `packages/praecis/youtube/tests/fixtures/eval-matrix/baseline-report.json`) with a default tolerance (e.g., no dimension drops >1.0 point).
- **Completion Criteria**: CI fails if quality thresholds breached; baseline fixture path and tolerance are documented in test file comments

### Task 4.5: Add cost tracking and budget alerting

- [ ] **Task**: Extend matrix runner to track token usage per cell and emit a cost summary in the report with fields: `extractionTokens`, `judgeTokens`, `extractionCostUsd`, `judgeCostUsd`, `estimatedCostUsd`, `costPerCell`, `costPerModel`, `costPerVideo`
- **Rationale**: A 10×10 matrix with judge scoring could cost $5–50+ per run. Cost visibility prevents budget surprises and enables cost-optimised model selection. Engineering-principles.md §5: "Think failure-first" — cost overrun is a failure mode.
- **Regression Guard**: Cost estimation uses conservative token-to-cost ratios from model registry; actual costs logged alongside estimates
- **Completion Criteria**: Cost summary appears in both markdown and JSON reports; total estimated cost displayed before execution in `--dry-run` mode

### Task 4.6: Keep AIDHA-TESTING-001 current

- [ ] **Task**: When Phase 4 tests are added, update AIDHA-TESTING-001 to register the new eval tests in the `packages/praecis/youtube` map and refresh the baseline counts
- **Rationale**: The test suite map is how reviewers keep coverage coherent across a growing repo; new eval tests should be discoverable.
- **Completion Criteria**: AIDHA-TESTING-001 lists the new eval tests; baseline counts refreshed; `pnpm docs:build` succeeds.

---

## Critical Path (Execution Order)

This is the minimum dependency order to avoid rework and undefined types/contracts.

```mermaid
flowchart TD
  A[1.1 Corpus JSON] --> B[1.1b Corpus schema + test]
  B --> C[1.2 Transcript local cache + committed excerpts]
  A --> D[1.3 Model registry]
  A --> E[1.4 Matrix runner + core eval types]
  E --> F[1.4b Extractor variant registry]
  F --> Z[1.8 Editorial ablation]
  E --> G[1.5 Extraction cache]
  C --> E
  C --> H[1.6 Golden annotations + guidelines]
  H --> I[2.1 Scoring rubric schema]
  I --> J[2.2 Judge prompt template]
  J --> K[2.2b Judge calibration loop]
  J --> L[2.2c Chunked scoring strategy]
  K --> M[2.3 Scoring executor]
  M --> N[2.5 Judge score caching]
  M --> O[2.4 Consensus scorer (optional)]
  E --> P[3.1 Aggregator]
  P --> Q[3.2 Markdown report]
  P --> R[3.3 JSON export]
  E --> S[3.4 CLI wiring]
  S --> Y[3.5 Invalidate-run rollback tool]
  I --> T[4.1 Rubric unit tests]
  J --> U[4.2 Prompt unit tests]
  E --> V[4.3 Mocked matrix integration test]
  R --> W[4.4 CI quality gate (pinned baseline)]
  S --> X[4.5 Cost tracking + dry-run estimate]
```
