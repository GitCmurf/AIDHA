---
document_id: AIDHA-EVAL-TASK-004
owner: Ingestion Engineering Lead
status: Approved
version: "0.1"
last_updated: 2026-03-09
title: Task 004 Completion Engineering Note
type: TESTING
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-EVAL-TASK-004
> **Owner:** Ingestion Engineering Lead
> **Status:** Approved
> **Version:** 0.1
> **Last Updated:** 2026-03-09
> **Type:** TESTING

# Task 004 Completion Engineering Note

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status   | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | -------- | --------------------- |
| 0.1     | 2026-03-09 | AI-assisted | Initial documentation                                           | —         | Approved | AIDHA-TASK-004        |

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

## What Remains Intentionally Deferred

- **Non-OpenAI Client Implementations**: We continue to use the `OpenAiCompatibleClient`
  exclusively. True native Anthropic or Google Gemini client objects are deferred since OpenRouter
  and LiteLLM effectively bridge the API gap for evaluation purposes.

- **Per-Token Actual Billing**: Actual token usage counts are not currently extracted from the LLM
  responses. Cost output in the report remains an *estimate* based on text length heuristics rather
  than strict API billing.

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
