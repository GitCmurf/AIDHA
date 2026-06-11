---
document_id: AIDHA-TASK-011
owner: Product
status: Draft
version: "0.1"
last_updated: 2026-06-11
title: Claim Quality Confidence Gates Task Plan
type: TASK
docops_version: "2.0"
area: CORE
keywords: [claims, extraction, quality, confidence, graph]
related_ids: [AIDHA-PLAN-009, AIDHA-PLAN-004, AIDHA-GUIDE-004]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TASK-011
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-06-11
> **Type:** TASK

# Task: Claim Quality Confidence Gates

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-06-11 | AI     | Create the implementation task list for source-faithful extraction, quality metadata, and pilot evaluation gates. | - | Draft | AIDHA-PLAN-009 |

## Objective

Make LLM claim extraction safe enough for graph population by separating reviewable draft candidates from trusted graph knowledge. The first tranche implements deterministic quality metadata, fixes the legacy prompt path, and documents the model-evaluation loop.

## Work Package 1: Quality Metadata Contract

- [x] Add claim-quality status fields to claim candidates.
- [x] Persist `supportSummary` and `rationale` into draft-claim metadata.
- [x] Emit `qualityStatus`, `qualityReasons`, `qualityScore`, `trusted`, and `supportCoverage` in generic CLI JSON.
- [x] Keep LLM-extracted claims untrusted by default.
- [x] Prevent rejected candidates from becoming `sourceSynopsis` bullets.

## Work Package 2: Deterministic Quality Gate

- [x] Add a deterministic gate for missing support, unsupported inference, domain drift, reported-speech wrappers, category-soup claims, weak recommendation rationale, and poor prose.
- [x] Apply the gate after editorial selection and optional rewrite/self-improvement.
- [x] Add focused unit tests for generic failure classes, not video-specific rewrites.

## Work Package 3: Source-Faithful Prompt Path

- [x] Make the generic extraction path use the balanced pass-1 prompt by default.
- [x] Leave the old legacy prompt behind an explicit `legacy-v1` opt-in only.
- [x] Replace "interesting high-resolution insight" language with source-faithful proposition language.
- [x] Remove generic physiological-diversity instructions from the default prompt path.
- [x] Bump the generic-hierarchy cache version to avoid stale prompt reuse.

## Work Package 4: Model and Pilot Evaluation

- [ ] Run the cached private pilot transcript through `gpt-5.4-mini`, `gpt-5.4-nano`, and `gemini-3.5-flash`.
- [ ] Compare model outputs against the AIDHA-PLAN-009 acceptance bar.
- [ ] Use `gpt-5.5` only if the routine ladder cannot separate prompt faults from model-capability faults.
- [ ] Use `gpt-5.5-pro` only for a tiny oracle/golden batch with explicit cost approval.
- [ ] Convert recurring private-pilot failures into public synthetic regression fixtures when they are source-neutral failure classes.

## Work Package 5: Remaining Hardening

- [ ] Add an optional LLM entailment verifier for borderline reviewable claims.
- [ ] Add CLI diagnostics that summarize quality-rejection counts per ingest run.
- [ ] Add review-queue filters for `qualityStatus`.
- [ ] Decide whether automatically rejected candidates should be persisted, exported only in diagnostics, or omitted from graph storage.
- [ ] Add a documented private pilot report template for claim-quality model comparisons.

## Validation Commands

Focused local validation for this tranche:

```bash
pnpm --filter @aidha/praecis-core exec vitest run --silent --reporter=dot \
  tests/extract/claim-quality.test.ts \
  tests/extract/source-synopsis.test.ts
```

```bash
pnpm --filter @aidha/ingestion-youtube exec vitest run --silent --reporter=dot \
  tests/prompt-pass1-v2.test.ts \
  tests/llm-claims.test.ts \
  tests/claim-candidate-schema.test.ts
```

```bash
pnpm --filter @aidha/praecis-cli exec vitest run --silent --reporter=dot \
  tests/cli.test.ts \
  --testNamePattern "ingests youtube through|surfaces core youtube source synopsis"
```

DocOps validation:

```bash
scripts/meminit-check.mjs docs/05-planning/plan-009-claim-quality-confidence-gates.md
scripts/meminit-check.mjs docs/05-planning/tasks/task-011-claim-quality-confidence-gates.md
scripts/meminit-check.mjs docs/60-devex/llm-claim-extraction.md
pnpm security:public-paths
```
