---
document_id: AIDHA-REF-005
owner: DocOps Working Group
status: Draft
last_updated: 2025-12-27
version: '0.2'
title: Initial Tools Roadmap
type: REF
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
# Initial Tools Roadmap

> **Document ID:** AIDHA-REF-005
> **Owner:** DocOps Working Group
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2025-12-27
> **Type:** REF

## Version History

| Version | Date       | Author       | Description                            |
| ------- | ---------- | ------------ | -------------------------------------- |
| 0.1     | 2025-11-09 | DocOps Agent | Seed roadmap for graph/taxonomy/ingest |
| 0.2     | 2025-12-27 | CMF          | Adopt DocOps 2.0 ID + metadata         |

## Overview

This roadmap sequences the first three interdependent packages in the pnpm workspace. Each package
must ship with PRD, ADR, tests, DocOps artifacts, and CI enforcement per the Constitution.

## 1. Graph Knowledge Backend (`packages/reconditum/`)

**Goal**: Provide a graph backend for personal cognition with JSON-LD export and contract tests.

### Tasks (Graph)

1. Maintain product requirements in AIDHA-PRD-001.
2. Capture architecture decisions in AIDHA-ADR-002.
3. Implement the package with contract tests and deterministic JSON responses.
4. Maintain quickstart/runbook docs and keep `pnpm docs:build` green.
5. Add observability hooks (structured logs, metrics) and document operational playbooks.

## 2. Taxonomy & Metadata (`packages/phyla/`)

**Goal**: Define classification schema, governance, and retrieval metadata contracts.

### Tasks (Taxonomy)

1. Maintain product requirements in AIDHA-PRD-003.
2. Capture architecture decisions in AIDHA-ADR-003.
3. Build schemas and validation tests for taxonomy definitions and metadata records.
4. Provide a migration/upgrade workflow and record provenance.
5. Wire CI so taxonomy changes trigger downstream re-classification checks.

## 3. YouTube Ingestion Engine (`packages/praecis/youtube/`)

**Goal**: Ingest playlists, capture transcripts, classify against the taxonomy, and publish outputs.

### Tasks (Ingestion)

1. Maintain product requirements in AIDHA-PRD-002.
2. Capture architecture decisions in AIDHA-ADR-004 and feature design in AIDHA-FDD-001.
3. Implement ingestion workers with retry + idempotency; persist to the graph backend.
4. Store AI prompt suites alongside code with an evaluation harness.
5. Maintain quickstarts/runbooks and add DocOps validation to CI.

## Cross-Cutting DocOps Tasks

- Add pre-commit/CI checks ensuring metadata + version tables exist for any doc inside `docs/` or
  `specs/`.
- Create shared templates for PRD/ADR/FDD referencing Document Standards and include them in
  `.specify/templates/`.
- Establish tagging convention (`doc-vX.Y`) to sync document releases with code deployments.

## Dependencies & Sequencing

1. Complete graph backend schema + APIs (milestone: contract tests + docs passing).
2. Finalize taxonomy metadata and integrate with graph backend (milestone: taxonomy validation CI gate).
3. Build ingestion engine on top of stable graph + taxonomy APIs.

Review this roadmap at the end of every release train and update the Version History accordingly.
