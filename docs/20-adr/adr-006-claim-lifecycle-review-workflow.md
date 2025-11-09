---
document_id: AIDHA-ADR-006
owner: Ingestion Architecture Lead
status: Draft
version: '0.1'
last_updated: 2026-02-06
title: Claim Lifecycle and Review Workflow
type: ADR
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-006
> **Owner:** Ingestion Architecture Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-06
> **Type:** ADR

# ADR: Claim Lifecycle and Review Workflow

## Version History

| Version | Date       | Author | Change Summary                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial ADR for claim review lifecycle  | —         | Draft  | —         |

## Context

- Claim extraction now produces high-volume candidate statements quickly.
- Retrieval and dossier export must remain trustworthy by default.
- Operators need fast CLI actions to curate claims in batches.

Without explicit lifecycle state, extraction noise is surfaced as if it were curated knowledge.

## Decision

Adopt an explicit claim lifecycle with `draft`, `accepted`, and `rejected` states.

- Default extraction state is `accepted` for baseline compatibility.
- Review queue defaults to `draft` claims (`review next`).
- Retrieval and dossier export default to `accepted` claims, with opt-in draft inclusion.
- Batch review actions (`review apply`) update state, text, tags, and optional task creation.

## Alternatives Considered

- Separate node types (`DraftClaim` and `Claim`): clearer semantics but higher migration and query
  complexity.
- Keep claims stateless and rely on score thresholds: less explicit and harder to audit.
- Full UI-first curation: out of scope for local-first CLI MVP.

## Consequences

- Benefits:
  - clear curation boundary for query/export
  - fast batch triage path for operators
  - provenance remains on the same claim node lifecycle
- Trade-offs:
  - state transition logic must be handled consistently in CLI and future APIs
  - existing tooling must account for `states` filters when needed
