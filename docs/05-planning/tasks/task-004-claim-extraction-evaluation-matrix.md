---
document_id: AIDHA-TASK-004
owner: Ingestion Engineering Lead
status: Draft
version: "0.1"
last_updated: 2026-03-02
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
> **Version:** 0.1
> **Last Updated:** 2026-03-02
> **Type:** TASK

# Claim Extraction Evaluation Matrix

## Version History

| Version | Date       | Author      | Change Summary                | Reviewers | Status | Reference             |
| ------- | ---------- | ----------- | ----------------------------- | --------- | ------ | --------------------- |
| 0.1     | 2026-03-02 | AI-assisted | Initial atomic task breakdown | —         | Draft  | AIDHA-TASK-003-ATOMIC |

## Overview

This task defines a systematic evaluation framework for YouTube claim extraction quality. The framework runs a **matrix** of **5–10 YouTube videos × ~10 LLM models**, then uses **LLM-as-judge** scoring to evaluate each extraction run across four quality dimensions:

| Dimension              | Definition                                                                                                  |
| :--------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Completeness**       | Does the extraction capture all substantive claims present in the transcript? (Recall proxy)                |
| **Accuracy**           | Are extracted claims faithful to the source material without hallucination or distortion? (Precision proxy) |
| **Topic Coverage**     | Do the claims proportionally cover the video's topic distribution and timeline? (Representativeness proxy)  |
| **Atomicity**          | Are claims single, indivisible assertions without redundancy? (Structure proxy)                             |

### Design Principles (per `engineering-principles.md`)

- **Separation of concerns**: extraction, scoring, and reporting are distinct modules
- **Determinism**: all tests reproducible without live API calls (cached transcripts + recorded LLM responses)
- **Validate at the boundary**: LLM judge responses validated via zod schema before aggregation
- **Fail explicitly**: scoring failures produce structured error context, not silent zeros
- **Test-first**: each module begins with a failing test before implementation

### Dependency

This task depends on AIDHA-TASK-003-ATOMIC Phase 1–2 completion (extraction improvements). The evaluation matrix validates those improvements and establishes ongoing regression baselines.

---

## Phase 1: Test Corpus & Infrastructure

### Task 1.1: Curate evaluation video corpus

- [ ] **Task**: Create [`packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json`] defining 5–10 YouTube video entries with fields: `videoId`, `url`, `title`, `channelName`, `durationMinutes`, `topicDomain`, `expectedClaimDensity` (low/medium/high), `rationale`
- **Rationale**: A diverse corpus spanning different content types (lecture, interview, panel, solo explainer), durations (15min–2hr+), and domains (nutrition, neuroscience, exercise physiology) prevents overfitting evaluation to a single video style. The existing test video `h_1zlead9ZU` (Huberman × Aragon, ~2hr, nutrition) is necessary but insufficient alone.
- **Selection Criteria**: At least 2 videos per domain category; at least 1 video <30min and 1 video >90min; at least 1 multi-speaker panel; no duplicate channels
- **Regression Guard**: Corpus file validated by schema test; minimum 5 entries enforced
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
- **Completion Criteria**: Corpus JSON passes schema validation; each entry includes rationale for inclusion; corpus covers ≥3 distinct topic domains

### Task 1.2: Ingest and cache transcripts for corpus videos

- [ ] **Task**: Create script [`scripts/eval-matrix/ingest-corpus.sh`] that runs `pnpm -C packages/praecis/youtube cli ingest video <url>` for each corpus entry and copies the resulting transcript JSON to [`packages/praecis/youtube/tests/fixtures/eval-matrix/transcripts/`]
- **Rationale**: Cached transcripts ensure deterministic evaluation without network dependency (engineering-principles.md §4: "Tests must be deterministic"). Live ingestion is a one-time setup step; all subsequent runs use cached fixtures.
- **Regression Guard**: Script is idempotent; skips already-cached transcripts; validates transcript non-empty
- **Completion Criteria**: Each corpus video has a cached transcript fixture; script exits non-zero if any ingestion fails

### Task 1.3: Define model registry

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/model-registry.ts`] exporting `EvalModel[]` with fields: `id`, `provider`, `baseUrl`, `modelName`, `contextWindow`, `supportsJsonMode`, `costPer1kTokens`, `notes`
- **Rationale**: Centralised model metadata enables cost estimation, capability gating (e.g., JSON mode), and reporting. Avoids stringly-typed model references scattered across scripts.
- **Model Candidates**: GPT-5, GPT-5-mini, Claude Opus 4, Claude Sonnet 4, Gemini 2.5 Pro, Gemini 2.5 Flash, Llama 4 Maverick, Llama 4 Scout, DeepSeek-R1, Qwen 3 235B
- **Regression Guard**: Registry validated by unit test; each entry requires non-empty `id` and `provider`
- **Completion Criteria**: Registry contains ≥8 models across ≥3 providers; TypeScript types exported; unit test validates schema

### Task 1.4: Implement matrix runner orchestrator

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/matrix-runner.ts`] with `runEvaluationMatrix(corpus: CorpusEntry[], models: EvalModel[], options: MatrixOptions): Promise<MatrixResult>` that iterates video × model combinations, invokes extraction, and collects raw claim sets
- **Rationale**: Orchestrator separates extraction execution from scoring (separation of concerns). Supports partial runs, resume-on-failure, and parallel execution per model.
- **Regression Guard**: Each run produces a deterministic output keyed by `videoId + modelId + promptVersion`; results cached to `out/eval-matrix/runs/`
- **Completion Criteria**: Orchestrator completes a 2-video × 2-model matrix in <5 minutes using cached transcripts; outputs structured JSON per cell

### Task 1.5: Add matrix result caching layer

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/matrix-cache.ts`] implementing read/write for matrix cell results keyed by `sha256(videoId + modelId + promptVersion + extractorVersion)`
- **Rationale**: LLM extraction is expensive (~$0.01–0.50 per video×model cell). Caching prevents re-extraction when only scoring logic changes. Cache invalidation on prompt/extractor version change ensures freshness.
- **Regression Guard**: Cache miss triggers extraction; cache hit skips extraction and logs cache-hit; stale cache detected by version mismatch
- **Completion Criteria**: Second run of identical matrix completes in <5 seconds; version bump triggers full re-extraction

### Task 1.6: Create human-verified golden annotations

- [ ] **Task**: Create [`packages/praecis/youtube/tests/fixtures/eval-matrix/golden-annotations.json`] containing human-verified "ideal" claim sets for 2 representative videos from the corpus (one short, one long)
- [ ] **Task**: Define schema for annotations: `videoId`, `idealClaims: string[]`, `rejectedClaims: { text: string, reason: string }[]`
- **Rationale**: To trust the "LLM-as-Judge", we must calibrate it against human judgment. This "Golden Set" serves as the ground truth for validating the scoring engine itself (Task 2.2).
- **Regression Guard**: JSON validated by schema; contains at least 2 videos
- **Spec Definition**:
  ```typescript
  interface GoldenAnnotation {
    videoId: string;
    idealClaims: string[]; // The perfect set of claims a human would extract
    rejectedClaims: { text: string; reason: "hallucination" | "redundant" | "fragment" | "topic-drift" }[];
  }
  ```
- **Completion Criteria**: Fixture file exists and contains manually curated claims for the selected videos

---

## Phase 2: LLM-as-Judge Scoring Engine

### Task 2.1: Define scoring rubric schema

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/scoring-rubric.ts`] exporting zod schemas for `ClaimSetScore` with fields: `completeness: number` (0–10), `accuracy: number` (0–10), `topicCoverage: number` (0–10), `atomicity: number` (0–10), `overallScore: number` (0–10), `reasoning: string`, `missingClaims: string[]`, `hallucinations: string[]`, `redundancies: string[]`, `gapAreas: string[]`
- **Rationale**: Structured scoring with explicit sub-dimensions prevents vague "good/bad" judgments. Zod validation at the boundary (engineering-principles.md §5) catches malformed judge responses before they corrupt aggregation.
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
    missingClaims: z.array(z.string()),
    hallucinations: z.array(z.string()),
    redundancies: z.array(z.string()),
    gapAreas: z.array(z.string())
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
- **Prompt Structure Spec**:
  - **System**: "You are an expert evaluator of information extraction quality... Output JSON only."
  - **User**:
    - `TRANSCRIPT_CONTEXT`: (Title, Channel, Description)
    - `TRANSCRIPT_TEXT`: (The text to evaluate against)
    - `CANDIDATE_CLAIMS`: (The JSON list of claims to score)
    - `CALIBRATION_EXAMPLES`: (Array of { claims: [], score: {}, reasoning: "" })
- **Regression Guard**: Prompt template tested for presence of all four dimension names; calibration examples included; output format instruction present
- **Completion Criteria**: Judge prompt produces parseable `ClaimSetScore` JSON from ≥2 different judge models; inter-rater agreement >0.7 on calibration examples

### Task 2.3: Implement scoring executor

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/scoring-executor.ts`] with `scoreClaimSet(judgeClient: LlmClient, judgeModel: string, transcript: string, claims: ClaimCandidate[], videoContext: VideoContext): Promise<Result<ClaimSetScore>>` that sends the judge prompt, validates the response, and retries once on parse failure
- **Rationale**: Scoring execution is separated from prompt construction (SRP) and from matrix orchestration. Retry with parse-error feedback (per task-003 Task 2.10 pattern) improves judge response quality.
- **Regression Guard**: Parse failures logged with raw response for debugging; retry includes validation error in follow-up prompt; timeout configurable via `AIDHA_EVAL_JUDGE_TIMEOUT_MS`
- **Completion Criteria**: Executor returns validated `ClaimSetScore` or structured error; retry success rate >80% on intentionally malformed responses

### Task 2.4: Implement multi-judge consensus scoring

- [ ] **Task**: Create [`packages/praecis/youtube/src/eval/consensus-scorer.ts`] with `scoreWithConsensus(...)` that runs ≥2 judge models (configurable) and computes mean scores with inter-rater variance
- **Rationale**: Single-judge scoring is unreliable due to model-specific biases. Multi-judge consensus with variance reporting surfaces disagreements that indicate ambiguous extraction quality. Engineering-principles.md §8: "Optimise after measuring" — variance data guides judge selection.
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
  interface MatrixReport {
    summary: { bestModel: string; worstModel: string; hardestVideo: string };
    modelStats: Record<string, { meanOverall: number; meanAccuracy: number; ... }>;
    videoStats: Record<string, { meanDifficulty: number; ... }>;
    leaderboards: Record<"accuracy" | "completeness" | "overall", { modelId: string; score: number }[]>;
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

- [ ] **Task**: Add `eval matrix` subcommand to [`packages/praecis/youtube/src/cli.ts`] with flags: `--corpus <path>`, `--models <comma-separated>`, `--judge-models <comma-separated>`, `--output-dir <path>`, `--format <md|json|both>`, `--resume` (skip cached cells), `--dry-run` (show matrix plan without execution)
- **Rationale**: CLI integration enables both interactive use and CI automation. `--dry-run` prevents accidental expensive runs; `--resume` enables incremental matrix completion.
- **Regression Guard**: CLI help text updated; `--dry-run` produces no LLM calls; unknown flags produce clear error
- **Completion Criteria**: `pnpm -C packages/praecis/youtube cli eval matrix --dry-run --corpus <path>` outputs planned matrix dimensions without API calls; `--help` documents all flags

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

- [ ] **Task**: Create [`packages/praecis/youtube/tests/eval/quality-gate.spec.ts`] that loads the latest matrix report JSON and asserts: best model overall score ≥6.0, no model scores <3.0 on any dimension, mean Atomicity score ≥5.0
- **Rationale**: CI gate prevents merging changes that degrade extraction quality below acceptable thresholds. Thresholds are intentionally conservative initially and tightened as extraction improves.
- **Regression Guard**: Gate reads from cached report; does not trigger new extraction; thresholds configurable via environment variables
- **Completion Criteria**: CI fails if quality thresholds breached; threshold values documented in test file comments

### Task 4.5: Add cost tracking and budget alerting

- [ ] **Task**: Extend matrix runner to track token usage per cell and emit a cost summary in the report with fields: `totalTokens`, `estimatedCostUsd`, `costPerCell`, `costPerModel`, `costPerVideo`
- **Rationale**: A 10×10 matrix with judge scoring could cost $5–50+ per run. Cost visibility prevents budget surprises and enables cost-optimised model selection. Engineering-principles.md §5: "Think failure-first" — cost overrun is a failure mode.
- **Regression Guard**: Cost estimation uses conservative token-to-cost ratios from model registry; actual costs logged alongside estimates
- **Completion Criteria**: Cost summary appears in both markdown and JSON reports; total estimated cost displayed before execution in `--dry-run` mode
