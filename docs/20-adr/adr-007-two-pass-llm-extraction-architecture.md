---
document_id: AIDHA-ADR-007
owner: Ingestion Architecture Lead
status: Draft
version: '0.1'
last_updated: 2026-02-06
title: Two-Pass LLM Extraction Architecture
type: ADR
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-007
> **Owner:** Ingestion Architecture Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-06
> **Type:** ADR

# ADR: Two-Pass LLM Extraction Architecture

## Version History

| Version | Date       | Author | Change Summary                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial ADR for two-pass extraction     | —         | Draft  | —         |

## Context

- Single-pass extraction blends candidate mining with editorial filtering and can be brittle.
- We need auditable claim provenance, deterministic reruns, and practical LLM cost control.
- Transcript sources and ordering may vary, but final claim sets must remain stable for review.

## Decision

Use a two-pass extraction architecture:

1. Pass 1 chunk miner:
   - chunk the transcript by time window
   - request structured JSON claims with excerpt IDs
   - enforce schema validation and bounded retries
2. Pass 2 deterministic editor:
   - remove low-value and short content
   - dedupe by normalized text and excerpt overlap
   - select diverse claims across chunks with stable ordering

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
- Trade-offs:
  - additional extraction complexity and metadata management
  - requires explicit diagnostics to explain filter/dedupe outcomes
