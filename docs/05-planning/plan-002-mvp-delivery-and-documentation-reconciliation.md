---
document_id: AIDHA-PLAN-002
owner: Product
status: Draft
version: "0.1"
last_updated: 2026-02-10
title: MVP Delivery Plan and Documentation Reconciliation
type: PLAN
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PLAN-002
> **Owner:** Product
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-10
> **Type:** PLAN

# MVP Delivery Plan and Documentation Reconciliation

## Version History

| Version | Date       | Author | Change Summary                         | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-10 | AI     | MVP implementation pland and doc audit | —         | Draft  | —         |

## Purpose

Provide an implementation plan and task list for MVP delivery.

This plan explicitly marks delivered work, remaining delivery tasks, and documentation reconciliation.

## MVP Objective

Build a local-first system that ingests YouTube resources, extracts auditable claims and references,
stores them in a typed graph, supports fast retrieval, and converts knowledge into tasks via CLI.

Success criteria:

1. Reliable ingest of metadata + transcript.
2. Deterministic dossier export with timestamped evidence.
3. Stable graph IDs and idempotent upsert behavior.
4. Fast claim-to-task flow.
5. Fast re-find query flow with provenance links.

## Scope and Non-goals

In scope:

- Graph storage, ingestion, claim/reference extraction, export, retrieval, review, task linkage.
- Proof of end-to-end concept with YouTube video transcripts as the (first) ingestion source.

Out of scope for MVP:

- Full scheduling/calendaring.
- Rich UI beyond CLI + Markdown/JSON artifacts.
- Perfect summarization/taxonomy governance.
- Other ingestion sources (web pages, PDFs, user notes, voice notes)

## Consolidated Implementation Status

### Milestone 0 to 8 (MVP core)

- [x] 0. Repo scaffolding and deterministic ID strategy.
- [x] 1. GraphStore contract + SQLite backend + contract tests.
- [x] 2. YouTube ingestion pipeline with transcript handling and idempotency.
- [x] 3. Claim extraction pipeline with provenance.
- [x] 4. Reference extraction and linkage.
- [x] 5. Deterministic dossier export.
- [x] 6. Inbox-first task creation and context display.
- [x] 7. Retrieval (`query`) with filters and SQLite FTS.
- [x] 8. Evaluation harness + deterministic fixture-based assertions.

### Strengthening milestones

- [x] Claim lifecycle states (`draft|accepted|rejected`) and accepted-first defaults.
- [x] Two-pass LLM extraction architecture with cache-key invalidation.
- [x] Review queue and batch apply workflow (atomic behavior tested).
- [x] Related retrieval and task-creation guardrail path.
- [x] Diagnose commands for transcript/extraction/editor.
- [x] Area/Goal/Project helper commands.
- [x] Split dossier exports and transcript JSON exports.
- [x] Source-prefixed default artifact naming and configurable export prefix.
- [x] Claim purge command for clean non-prod re-runs.
- [x] Preflight command for local toolchain validation.

## Documentation Coverage Audit

### ADR coverage (`docs/20-adr`)

- [x] `AIDHA-ADR-006` covers claim lifecycle and review states.
- [x] `AIDHA-ADR-007` covers two-pass extraction architecture.
- [x] `AIDHA-ADR-004` reconciled in this pass to capture ingestion architecture decisions.

### FDD coverage (`docs/30-fdd`)

- [x] `AIDHA-FDD-002` covers pass-1 claim mining.
- [x] `AIDHA-FDD-003` covers pass-2 editorial selection.
- [x] `AIDHA-FDD-001` reconciled in this pass to reflect implemented ingestion engine behavior.

### Runbook coverage (`docs/50-runbooks`)

- [x] `AIDHA-RUNBOOK-003` covers operational ingest/extract/review/export/diagnose commands.
- [x] Runbook updated to include purge and source-prefixed export defaults.

### Testing coverage (`docs/55-testing`)

- [x] `AIDHA-TESTING-001` tracks current suite groups, hardening focus, and baselines.

### DevEx coverage (`docs/60-devex`)

- [x] `AIDHA-GUIDE-002` (`ingest-quickstart.md`) reflects current CLI workflow.
- [x] `AIDHA-GUIDE-004` (`llm-claim-extraction.md`) reflects two-pass and fixture usage.

### README coverage

- [x] Root `README.md` reconciled with current workspace state and command patterns.
- [x] `packages/praecis/youtube/README.md` reconciled with current CLI and doc links.

## Remaining Tasks to Ship MVP

The implementation backlog for MVP scope is complete. Remaining delivery tasks are release tasks:

- [ ] Run final end-to-end acceptance run on target fixture/video set and archive outputs.
- [ ] Resolve open review findings in `packages/reconditum` (Gephi export filtering + stats parity).
- [ ] Cut MVP release notes and tag a baseline commit.
- [ ] 'Golden' tests
- [ ] Readiness review for public GitHub commit

## Delivery Task List (Codex-executable)

### Phase A: Final acceptance run

- [ ] Execute ingest -> extract -> refs -> export -> query on agreed test videos.
- [ ] Capture command transcript and generated artifacts in `docs/01-indices/` or release notes.
- [ ] Verify deterministic rerun behavior for unchanged input.

Acceptance:

- All success criteria are demonstrated with reproducible commands and artifacts.

### Phase B: Backend review parity fixes

- [ ] Fix SQLite `exportGephi` edge filtering when `nodeTypes` is provided.
- [ ] Fix SQLite `getGraphStats` top-degree handling for dangling edge endpoints.
- [ ] Add/adjust parity tests across in-memory/SQLite/levelgraph as applicable.

Acceptance:

- Review findings closed with passing tests and no backend divergence for covered scenarios.

### Phase C: Release packaging

- [ ] Update changelog and release summary docs.
- [ ] Confirm docs and tests are green (`pre-commit`, `meminit check`, `pnpm docs:build`).
- [ ] Tag MVP baseline commit and publish the delivery note.

Acceptance:

- One auditable MVP baseline with synchronized code, tests, and docs.

## Risks and Controls

- Risk: extraction quality drift due to prompt/model changes.
  - Control: prompt versioning + cache invalidation + fixture invariants.
- Risk: backend behavior drift.
  - Control: contract/parity tests and review-driven fixes before release tag.
- Risk: doc drift after rapid iteration.
  - Control: DocOps gates plus this reconciliation checklist.
