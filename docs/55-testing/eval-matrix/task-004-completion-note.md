---
document_id: AIDHA-EVAL-004
owner: Ingestion Engineering Lead
status: Approved
version: "0.3"
last_updated: 2026-05-09
title: Task 004 Completion Engineering Note
type: TESTING
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-EVAL-004
> **Owner:** Ingestion Engineering Lead
> **Status:** Approved
> **Version:** 0.3
> **Last Updated:** 2026-05-09
> **Type:** TESTING

# Task 004 Completion Engineering Note

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status   | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | -------- | --------------------- |
| 0.1     | 2026-03-09 | AI-assisted | Initial documentation                                           | —         | Approved | AIDHA-TASK-004        |
| 0.2     | 2026-05-09 | AI-assisted | Clarified provider-client routing strategy and native-client triggers | —         | Approved | AIDHA-TASK-008 / TD-020 |
| 0.3     | 2026-05-09 | AI-assisted | Added actual usage capture semantics for eval reports           | —         | Approved | AIDHA-TASK-008 / TD-019 |

## What Was Fixed

- **Model-Aware Runtime Wiring**: The evaluation matrix CLI (`eval matrix`) now fully respects the
  selected models in the registry. It correctly maps Anthropic and Google models to use OpenRouter
  or other proxies automatically, falling back to process environments appropriately.

- **Cost Estimation & Dry-Run Planning**: Dry-run mode (`--dry-run`) now calculates and emits
  precise cost estimates for both extraction and judge steps using the latest `costPer1kTokens`
  model registry pricing. The Task 004 full-matrix budget ceiling of $25.00 is actively enforced
  and warned against.

- **Asynchronous I/O**: Transcript loading was refactored to be non-blocking and fully asynchronous
  across large corpora, avoiding main-thread stall issues during batch validation.

- **Run-Scoped Invalidation**: Implemented targeted cache clearing via `--run-id` and
  `--invalidate-run <runId>`, allowing engineers to re-run specific evaluation slices without
  wiping the global cache.

- **Consensus & Variance Reporting**: Multi-judge evaluations now automatically compute per-cell
  consensus mean scores and per-dimension variance. High-variance cells (disagreement between
  judges where variance > 2.0 on any dimension) are flagged with ⚠️ warnings in the report for
  manual auditing.

- **Artifact Traces & Structured Logs**: Every evaluation cell now captures the exact
  prompt/response pairs for extraction and scoring steps. These are exported as stable,
  machine-readable artifacts under `out/eval-matrix/runs/<runId>/cells/`. Progress is logged with
  index/total and per-cell durations for better operational visibility.

- **Baseline CI Integration**: A deterministic quality gate is active, failing builds that deviate
  beyond the tolerance threshold when compared to `baseline-report.json`.

- **Actual Usage Capture**: LLM clients normalize provider token usage when responses include it.
  Matrix cells now keep estimated usage and actual usage separately, aggregate reports surface the
  number of cells with actual usage, and Markdown reports include an actual-usage section whenever
  provider metadata is available.

## What Remains Intentionally Deferred

- **Additional Native Provider Implementations**: The runtime uses `GeminiApiClient` for
  `google-aistudio` models and OpenAI-compatible clients for OpenAI, z.AI, Xiaomi, and OpenRouter
  routes. Additional native clients remain deferred until there is concrete evidence that the
  bridge route blocks correctness, usage capture, JSON-mode behavior, rate-limit handling, or
  provider-specific safety/auth controls.

- **Complete Provider Billing Parity**: Some providers or bridge routes may omit usage metadata.
  Eval reports therefore retain dry-run and fallback estimates, and mark mixed availability instead
  of silently treating estimates as actual billing.

## Provider-Client Routing Decision

The eval harness is intentionally hybrid:

- `google-aistudio` models use the native Gemini API client because Gemini request/response shapes
  are not OpenAI-compatible and the code already has a focused `GeminiApiClient` adapter.
- `openai`, `zai`, `xiaomi`, and `openrouter` models use the OpenAI-compatible client route. This
  keeps the harness small while the providers expose compatible chat-completion surfaces.
- The model registry records this decision in each model's `clientRoute` field so eval reports,
  routing tests, and future provider additions do not have to infer the route from comments or
  provider names.

Add a new native provider client only when at least one of these triggers is observed in a current
eval run or provider integration test:

- OpenAI-compatible responses omit required usage metadata that cannot be recovered reliably.
- JSON or structured-output behavior differs enough to affect claim extraction correctness.
- Provider-specific rate-limit, retry, safety, or auth controls are required for stable eval runs.
- The bridge adds unacceptable latency, truncation, or error translation that changes scoring
  outcomes.

Until one of those triggers is met, native-client work is deferred and eval behavior should remain
unchanged.

## How to Run the Seed Evaluation Matrix

To run the evaluation over the deterministic seed corpus:

```bash
pnpm run eval matrix \
  --corpus packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json \
  --tier budget \
  --judge-models gpt-4o \
  --format md
```

To plan the execution without incurring costs:

```bash
pnpm run eval matrix \
  --corpus packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json \
  --tier budget \
  --judge-models gpt-4o \
  --format md \
  --dry-run
```

## Evidence Supporting Default Choices

The updated Matrix Report now automatically surfaces a **"Recommendations for Defaults"** section.
By aggregating scores across 5 core dimensions (completeness, accuracy, topicCoverage, atomicity,
overallScore) and automatically identifying the best budget and overall models, engineering
leadership can immediately choose baseline defaults from the automated markdown output without
manually parsing the heatmap.

## Acceptance Criteria (Protected by Tests)

The following tests guard the evaluation matrix framework and should pass before merging any changes:

- `packages/praecis/youtube/tests/eval/corpus-schema.test.ts` - Validates corpus JSON schema
- `packages/praecis/youtube/tests/eval/model-registry.test.ts` - Validates model registry entries
- `packages/praecis/youtube/tests/eval/scoring-rubric.test.ts` - Validates scoring schema
- `packages/praecis/youtube/tests/eval/judge-prompt.test.ts` - Validates judge prompt template
- `packages/praecis/youtube/tests/eval/matrix-runner.test.ts` - Integration test for matrix runner
- `packages/praecis/youtube/tests/eval/cli-eval-path.test.ts` - Tests CLI argument parsing
- `packages/praecis/youtube/tests/eval/quality-gate.spec.ts` - CI quality gate for regression detection

Run tests with: `pnpm test --filter praecis-youtube -- eval`
