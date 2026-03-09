---
document_id: AIDHA-EVAL-MANUAL-BASELINE
owner: Ingestion Engineering Lead
status: Draft
version: "0.1"
last_updated: 2026-03-09
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
> **Version:** 0.1
> **Last Updated:** 2026-03-09
> **Type:** TESTING

# Manual Baseline (No Harness)

## Version History

| Version | Date       | Author      | Change Summary                                                  | Reviewers | Status | Reference             |
| ------- | ---------- | ----------- | --------------------------------------------------------------- | --------- | ------ | --------------------- |
| 0.1     | 2026-03-09 | AI-assisted | Initial documentation                                           | —         | Draft  | AIDHA-TASK-004        |

This document describes the procedure to extract claims directly via external UIs (Gemini web, ChatGPT) from transcripts, bypassing the AIDHA extraction harness.

## Objective

To sanity-check what content is extractable independent of our harness, prompts, post-processing, and editorial wrappers, to answer: "Are we consistently excluding valuable content because of our pipeline, independent of the base model?"

This procedure is protected by the evaluation framework tests in `packages/praecis/youtube/tests/eval/matrix-runner.test.ts`.

## Procedure

1. Copy the exact transcript excerpt from `packages/praecis/youtube/tests/fixtures/eval-matrix/transcript-excerpts/`.
2. Open an external LLM UI. Use low temperature (or equivalent deterministic setting) if available.
3. Use one of the prompt templates located in `packages/praecis/youtube/tests/fixtures/eval-matrix/manual-baseline/`.
4. Capture the exact response into a snapshot file, e.g., `short_solo_1-chatgpt-high-recall.md`.
5. Compare the output to the harness matrix output to look for systematic differences.

## Systemic Deltas

- *None found yet. Snapshots are meant to be added and this section updated during validation.*
