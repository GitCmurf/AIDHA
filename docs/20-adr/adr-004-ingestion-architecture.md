---
document_id: AIDHA-ADR-004
owner: Ingestion Architecture Lead
status: Draft
last_updated: 2026-02-10
version: '0.3'
title: Ingestion Architecture and Summarization Strategy
type: ADR
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-004
> **Owner:** Ingestion Architecture Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-02-10
> **Type:** ADR

## Version History

| Version | Date       | Author | Change Summary                                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Placeholder ADR created                                  | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0 (ID + metadata + filename) | —         | Draft  | —         |
| 0.3     | 2026-02-10 | AI     | Reconcile with implemented ingestion architecture and controls | — | Draft | — |

## Context

The MVP ingests YouTube resources and must be:

- deterministic for reruns and contract tests
- auditable with excerpt-level provenance
- resilient to transcript source variability
- operable via CLI with actionable diagnostics

## Decision

Use a modular ingestion architecture with explicit boundaries:

1. **Ingestion pipeline (`IngestionPipeline`)**
   - Inputs: playlist/video identifiers.
   - Outputs: `Resource` + `Excerpt` nodes with deterministic IDs.
   - Behavior: idempotent upsert semantics with transcript status metadata.

2. **Transcript acquisition strategy**
   - Primary: direct YouTube transcript retrieval.
   - Fallback: `yt-dlp` retrieval with configurable cookies/binary/timeout/JS runtimes.
   - Diagnostics: `diagnose transcript` and `preflight youtube` for environment readiness.

3. **Extraction strategy**
   - Claim extraction is handled as a separate pipeline step (optional LLM).
   - Reference extraction is independent and link-based.
   - Editorial determinism and claim lifecycle are delegated to ADR-006 and ADR-007.

4. **Storage strategy**
   - Persist to `GraphStore` with SQLite default backend.
   - Keep operational metadata on resources while preserving knowledge export scopes.

5. **Operational controls**
   - Add source-prefixed artifact defaults for exported dossier/transcript files.
   - Provide resource-scoped purge for claims in non-production reset workflows.

## Consequences

- Benefits:
  - ingestion remains source-focused and separate from extraction policy
  - failures are diagnosable without stepping through code
  - transcript fallback strategy is explicit and configurable
  - reruns remain safe due to deterministic IDs and upserts
- Trade-offs:
  - YouTube-specific fallback logic introduces external toolchain dependency (`yt-dlp`)
  - CLI surface area grows and must be kept synchronized with docs/help/tests

## Related Documents

- `AIDHA-FDD-001` (ingestion engine design)
- `AIDHA-RUNBOOK-003` (operations)
- `AIDHA-GUIDE-002` (quickstart)
- `AIDHA-ADR-006` (claim lifecycle)
- `AIDHA-ADR-007` (two-pass extraction)
