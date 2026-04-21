---
document_id: AIDHA-EVAL-MANUAL-BASELINE
owner: Ingestion Engineering Lead
status: Draft
version: "0.2"
last_updated: 2026-03-15
title: Manual Baseline (No Harness)
type: TESTING
docops_version: "2.0"
---

<!-- markdownlint-disable MD013 MD031 -->
<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-EVAL-MANUAL-BASELINE
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-03-15
> **Type:** TESTING

# Manual Baseline (No Harness)

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | ------ | --------------------- |
| 0.1     | 2026-03-09 | AI-assisted | Initial documentation                                           | —         | Draft  | AIDHA-TASK-004        |
| 0.2     | 2026-03-15 | AI-assisted | Clarify canonical JSON gold hierarchy format                    | —         | Draft  | AIDHA-TASK-004        |

This document describes the procedure to extract claims directly via external UIs (Gemini web, ChatGPT) from transcripts, bypassing the AIDHA extraction harness.

## Objective

To sanity-check what content is extractable independent of our harness, prompts, post-processing, and editorial wrappers, to answer: "Are we consistently excluding valuable content because of our pipeline, independent of the base model?"

This procedure is protected by the evaluation framework tests in `packages/praecis/youtube/tests/eval/matrix-runner.test.ts`.

## Procedure

1. Copy the exact transcript excerpt from `packages/praecis/youtube/tests/fixtures/eval-matrix/transcript-excerpts/`.
2. Open an external LLM UI. Use low temperature (or equivalent deterministic setting) if available.
3. Use one of the prompt templates located in `packages/praecis/youtube/tests/fixtures/eval-matrix/manual-baseline/`.
4. Capture the exact response into a working snapshot file, e.g., `short_solo_1-chatgpt-high-recall.md`.
5. Convert any golden/manual baseline you intend to keep into valid JSON before treating it as canonical.
6. Compare the output to the harness matrix output to look for systematic differences.

## Canonical Format

Markdown notes are acceptable as disposable working drafts, but the canonical manual/golden artifact
must be valid JSON.

- Gold hierarchies should use nested `children` arrays under `idealClaims`.
- Claim nodes should use normalized machine-readable `type` values such as `fact`,
  `research_finding`, `recommendation`, or `assertion`.
- The checked-in fixture contract lives in
  `packages/praecis/youtube/tests/fixtures/eval-matrix/golden-annotations.json`.
- The current matrix can still consume a flattened view derived from the hierarchy; the hierarchy is
  retained for diagnostics and future graph ingest.

## Systemic Deltas

- *None found yet. Snapshots are meant to be added and this section updated during validation.*
