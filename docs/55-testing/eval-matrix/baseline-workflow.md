---
document_id: AIDHA-EVAL-BASELINE
owner: Ingestion Engineering Lead
status: Draft
version: "0.1"
last_updated: 2026-03-09
title: Evaluation Matrix Baseline Workflow
type: TESTING
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-EVAL-BASELINE
> **Owner:** Ingestion Engineering Lead
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-03-09
> **Type:** TESTING

# Evaluation Matrix Baseline Workflow

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | ------ | --------------------- |
| 0.1     | 2026-03-09 | AI-assisted | Initial documentation                                           | —         | Draft  | AIDHA-TASK-004        |

The evaluation matrix (`eval matrix`) provides a quantitative assessment of the LLM extraction
pipeline. To prevent regressions, we maintain a pinned baseline report.

## CI Quality Gate

The CI quality gate (`tests/eval/quality-gate.spec.ts`) compares the `latest.json` report against
`baseline.json`.

**Prerequisite:** You must run the evaluation matrix (step 2 below) to generate `latest.json`
before running this test.

It fails if:

- A model's score drops by more than the allowed tolerance (default: 1.0 points).
- The schema of the report is invalid.
- Required models are missing from the latest run.

If `REQUIRE_EVAL_GATE=1` or `CI=true` is set, the gate requires both reports to exist.

## Refreshing the Baseline

When substantial improvements to the prompts, extraction logic, or scoring rubrics are made, the
baseline needs to be refreshed.

### Step-by-Step

1. **Clear old evaluation caches (optional but recommended):**

   ```bash
   # Clear all caches (or use --invalidate-run <runId> for a specific run)
   pnpm run eval matrix --clear-all --yes
   ```

2. **Run a full evaluation matrix:**

   Run the matrix using the standard seed corpus and target models.

   ```bash
   pnpm run eval matrix \
     --corpus packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json \
     --tier budget \
     --judge-models gpt-4o \
     --format both
   ```

3. **Verify the new report:**

   Check the run output directory (default: `out/eval-matrix/reports/`;
   if a run ID is provided via `--run-id`, use `out/eval-matrix/runs/<runId>/`).

   Review:
   - `latest.md`: Executive summary and scorecards.
   - `latest.json`: Machine-readable aggregate data.
   - `cells/*.json`: Per-cell detailed artifacts including extraction/scoring traces.

   Ensure the scores are acceptable and truly reflect an improvement (or an expected change).

4. **Pin the new baseline:**

   Copy the newly generated report into the fixtures directory:

   ```bash
   cp out/eval-matrix/reports/latest.json \
      packages/praecis/youtube/tests/fixtures/eval-matrix/baseline.json
   ```

5. **Commit the baseline:**

   ```bash
   git add packages/praecis/youtube/tests/fixtures/eval-matrix/baseline.json
   git commit -m "chore(eval): update extraction matrix baseline"
   ```

## Seed Corpus Management

The seed corpus (`corpus.json`) should be kept small and deterministic. Do not add raw,
non-reproducible videos without caching the transcripts in
`tests/fixtures/eval-matrix/transcript-excerpts/`.
