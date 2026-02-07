---
document_id: AIDHA-FDD-003
owner: Ingestion Engineering Lead
status: Draft
version: '0.1'
last_updated: 2026-02-06
title: Second-Pass Editorial Claim Selection
type: FDD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-FDD-003
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-06
> **Type:** FDD

# FDD: Second-Pass Editorial Claim Selection

## Version History

| Version | Date       | Author | Change Summary                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial FDD for editorial second pass      | —         | Draft  | —         |

## Overview

Pass 2 transforms candidate claims into a stable, reviewable claim set.
This pass is designed to be reusable across transcript sources, not only YouTube.

## Editorial Rules

- Remove low-value or boilerplate content (sponsor/intro/outro patterns).
- Remove short claims below readability thresholds.
- Deduplicate candidates using:
  - normalized text equivalence
  - excerpt overlap ratio
- Rank by confidence + text quality score.
- Ensure timeline diversity by selecting best-per-chunk first, then filling by rank.
- Sort final claims deterministically by timestamp + text + excerpt key.

## Reusability Contract

Pass 2 consumes only `ClaimCandidate[]` plus chunk index metadata.
It does not require source-specific API calls. Any source that yields candidates with provenance can
reuse this editor implementation.

## Outputs

- Final selected claims with stable ordering.
- Candidate metadata preserved for downstream review:
  - method
  - model
  - promptVersion
  - chunkIndex

## Acceptance Signals

- Reordered input candidates produce identical final claim set.
- Duplicate candidates with overlapping excerpts collapse to the best-ranked candidate.
- Final claim count respects configured `maxClaims`.

## Test Coverage

- `packages/praecis/youtube/tests/llm-claims.test.ts`
  - deterministic dedupe under reversed candidate order
  - diversity-aware output selection
  - stable cache and parsing integration with first pass
