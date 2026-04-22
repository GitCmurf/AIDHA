---
document_id: AIDHA-ADR-007
owner: Ingestion Architecture Lead
status: Draft
version: "0.2"
last_updated: 2026-04-21
title: Two-Pass LLM Extraction Architecture
type: ADR
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-007
> **Owner:** Ingestion Architecture Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-04-21
> **Type:** ADR

# ADR: Two-Pass LLM Extraction Architecture

## Version History

| Version | Date       | Author | Change Summary                                              | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ----------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial ADR for two-pass extraction                         | —         | Draft  | —         |
| 0.2     | 2026-04-21 | AI     | Refine with self-improvement pass and narrow evaluation pass | —         | Draft  | —         |

## Context

- Single-pass extraction blends candidate mining with editorial filtering and can be brittle.
- We need auditable claim provenance, deterministic reruns, and practical LLM cost control.
- Transcript sources and ordering may vary, but final claim sets must remain stable for review.

## Decision

Use an evolved two-pass extraction architecture with an optional self-improvement loop:

1. **Pass 1 chunk miner:**
   - chunk the transcript by time window
   - request structured JSON claims with excerpt IDs
   - enforce schema validation and bounded retries
2. **Pass 2b Self-Improvement (Optional):**
   - Sits between Pass 1 and the deterministic editor.
   - Uses "teacher-gap" hints or self-reflection prompts to refine the initial set.
   - Controlled by `selfImproveMaxRounds` (default 0).
3. **Pass 3 deterministic editor (formerly Pass 2):**
   - remove low-value and short content
   - dedupe by normalized text and excerpt overlap
   - select diverse claims across chunks with stable ordering

**Evaluation Loop:**
Use a "Narrow Judge" (LLM-based) as the primary quality signal for automated verification of
extraction deltas. The narrow judge compares candidate sets against a flattened golden annotation
forest, providing quantitative coverage and faithfulness metrics.

Caching is keyed by chunk bounds + transcript hash + prompt version + model.
Cache payload includes validation metadata so prompt/model/transcript changes force refresh.

## Alternatives Considered

- Single-pass prompt with strict output limits:
  - simpler implementation
  - poorer control over diversity and deterministic post-processing
- Deterministic-only extraction (no LLM):
  - strong repeatability
  - weak claim quality and salience on long transcripts
- Full semantic embedding + reranker in MVP:
  - better ranking quality
  - higher complexity and operational burden

## Consequences

- Benefits:
  - stronger auditability and determinism
  - clear seams for future source-agnostic reuse
  - resilient cache invalidation behavior
  - **Empirical verification:** Integrated narrow judge allows for data-driven prompt engineering
    and regression detection.
- Trade-offs:
  - additional extraction complexity and metadata management
  - requires explicit diagnostics to explain filter/dedupe outcomes
  - **Cost:** Self-improvement pass significantly increases token consumption per video.
