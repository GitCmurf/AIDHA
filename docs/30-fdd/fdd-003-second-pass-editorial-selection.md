---
document_id: AIDHA-FDD-003
owner: Ingestion Engineering Lead
status: Draft
version: '0.3'
last_updated: 2026-02-08
title: Second-Pass Editorial Claim Selection
type: FDD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-FDD-003
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-02-08
> **Type:** FDD

# FDD: Second-Pass Editorial Claim Selection

## Version History

| Version | Date       | Author | Change Summary                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial FDD for editorial second pass      | —         | Draft  | —         |
| 0.2     | 2026-02-08 | AI     | Add modular v1/v2 editor and diagnostics contract | —   | Draft  | —         |
| 0.3     | 2026-02-08 | AI     | Add optional rewrite pass guardrails and cache model | — | Draft | —         |

## Overview

Pass 2 transforms candidate claims into a stable, reviewable claim set.
This pass is designed to be reusable across transcript sources, not only YouTube.

## Editorial Rules

- `v1` editor behavior (compatibility mode):
  - Remove low-value or boilerplate content (sponsor/intro/outro patterns).
  - Remove short claims below readability thresholds.
  - Deduplicate candidates using normalized text equivalence and excerpt overlap.
  - Ensure diversity by selecting best-per-chunk first, then filling by rank.
- `v2` editor behavior (default mode):
  - Uses deterministic heuristic scoring for actionability, specificity, and evidence density.
  - Scoring Weights:
    - Actionability: 0.25
    - Confidence: 0.20
    - Specificity (numbers/units): 0.15
    - Evidence Density: 0.15
    - Domain/Classification Bonus: 0.15/0.10
  - Penalties:
    - Boilerplate POS Pattern: -0.55
    - Fragment Indicator: -0.50
    - Transcript Echo (>90% overlap): -0.25
    - Context-dependent pronoun start: -0.15
  - Uses time-window diversity selection with max-per-window limits (default 3 claims per 5 mins).
  - Semantic similarity deduplication (threshold 0.8 token overlap).
- Optional rewrite behavior (opt-in via `--editor-llm`):
  - Applies only after deterministic pass 2 selection.
  - Uses strict JSON schema (`index`, `text`) and deterministic cache keying.
  - Enforces provenance guardrails (numeric preservation, keyword overlap, edit-ratio cap).
- Final selected claims are always sorted deterministically by timestamp + text + excerpt key.

## Reusability Contract

Pass 2 consumes only `ClaimCandidate[]` and deterministic config, then returns selected
claims (and optional diagnostics). It does not require source-specific API calls.

- Shared implementation module: `packages/praecis/youtube/src/extract/editorial-ranking.ts`
- Shared metrics module: `packages/praecis/youtube/src/extract/editorial-metrics.ts`

Any source that yields candidates with provenance can reuse this editor implementation.

## Outputs

- Final selected claims with stable ordering.
- Optional diagnostics payload for explainability:
  - dropped counts by reason
  - window coverage summary
  - consistency invariant checks
- Optional rewrite cache artifacts keyed by transcript + selected-candidate hash.
- Candidate metadata preserved for downstream review:
  - method
  - model
  - promptVersion
  - chunkIndex

## Acceptance Signals

- Reordered input candidates produce identical final claim set.
- Duplicate candidates with overlapping excerpts collapse to the best-ranked candidate.
- Final claim count respects configured `maxClaims`.
- Diagnostics invariants hold: `selected + dropped == total candidates`.

## Test Coverage

- `packages/praecis/youtube/tests/llm-claims.test.ts`
  - deterministic dedupe under reversed candidate order
  - diversity-aware output selection
  - stable cache and parsing integration with first pass
- `packages/praecis/youtube/tests/editorial-ranking.v1.test.ts`
  - v1 characterization and deterministic compatibility behavior
- `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts`
  - v2 filtering, diversity, and diagnostics invariants
- `packages/praecis/youtube/tests/editorial-metrics.test.ts`
  - fragment/boilerplate counting and timeline coverage metrics
- `packages/praecis/youtube/tests/llm-claims.test.ts`
  - rewrite cache behavior and rewrite guardrail checks
