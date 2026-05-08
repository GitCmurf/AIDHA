---
document_id: AIDHA-EVAL-BASELINE
owner: Ingestion Engineering Lead
status: Published
version: "0.4"
last_updated: 2026-05-03
title: Evaluation Matrix Baseline Workflow
type: TESTING
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-EVAL-BASELINE
> **Owner:** Ingestion Engineering Lead
> **Status:** Published
> **Version:** 0.4
> **Last Updated:** 2026-05-03
> **Type:** TESTING

# Evaluation Matrix Baseline Workflow

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | ------ | --------------------- |
| 0.1     | 2026-03-09 | AI-assisted | Initial documentation                                           | —         | Published | AIDHA-TASK-004        |
| 0.2     | 2026-03-13 | AI-assisted | Replace non-doc quality-gate link with MkDocs-safe code reference | —         | Published | AIDHA-TASK-004        |
| 0.3     | 2026-03-15 | AI-assisted | Document hierarchical JSON golden annotations                   | —         | Published | AIDHA-TASK-004        |
| 0.4     | 2026-05-03 | AI-assisted | Document TypeScript package CI gate and self-improvement guardrails | —       | Published | AIDHA-TASK-006        |

The evaluation matrix (`eval matrix`) provides a quantitative assessment of the LLM extraction
pipeline. To prevent regressions, we maintain a pinned baseline report.

Hierarchical golden claim annotations are stored separately from the aggregate report fixture as
JSON with nested `children`. These annotations are the canonical source for manual/gold claim
structure and can be flattened for the current judge flow when needed.

## CI Quality Gate

The CI quality gate in `packages/praecis/youtube/tests/eval/quality-gate.spec.ts` compares the
`latest.json` convenience alias against `baseline.json`.

**Prerequisite:** For local runs, you must run the evaluation matrix (step 2 below) to generate a
stamped report and refresh `latest.json` before running this test.

It fails if:

- A model's score drops by more than the allowed tolerance (default: 1.0 points).
- The schema of the report is invalid.
- Required models are missing from the latest run.

If `REQUIRE_EVAL_GATE=1` or `CI=true` is set, the gate requires both reports to exist. In the
repository workflow, `.github/workflows/typescript-packages.yml` seeds both files from the checked-in
`packages/praecis/youtube/tests/fixtures/eval-matrix/baseline-report.json` fixture before running
the package test suite, so CI does not depend on an ad hoc report-generation step.

### Acceptance Criteria

This test protects against:

- **Score regression**: Model quality drops beyond tolerance threshold
- **Schema invalid**: Report structure changes break downstream consumers
- **Missing models**: Baseline and latest must have comparable models

Run the targeted gate with:

```bash
pnpm --dir packages/praecis/youtube exec vitest run tests/eval/quality-gate.spec.ts tests/eval/quality-gate.test.ts
```

The repository also runs the TypeScript package build and test suite in
`.github/workflows/typescript-packages.yml` on pull requests and pushes to the default branches.
The YouTube package full test suite is not skipped in CI; the workflow timeout is intentionally
larger than the local package runtime so slow tests fail clearly instead of silently omitting the
package gate.

Self-improvement gate comparisons are fail-closed: a baseline and self-improvement cell must use
the same score source for a comparable row. Narrow Judge coverage only counts matches whose
`candidateText` exists in the evaluated claim set, and the extraction self-improvement loop is
bounded by an input-token budget before each LLM round.

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

   Check the run output directory (default: `out/eval-matrix/reports/`);
   if a run ID is provided via `--run-id`, use
   `out/eval-matrix/runs/<runId>/`).

   Review:
   - `eval-matrix-<stamp>.md` or `eval-matrix-<runId>-<stamp>.md`: Executive scorecard.
   - `eval-matrix-<stamp>.json` or `eval-matrix-<runId>-<stamp>.json`: Aggregate data.
   - `latest.md` / `latest.json`: Convenience aliases to the newest stamped report.
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
