---
document_id: AIDHA-ADR-005
type: ADR
title: Graph DB Rationale
status: Draft
version: "0.3"
last_updated: "2026-01-29"
owner: Graph Architecture Lead
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-ADR-005
> **Owner:** Graph Architecture Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-01-29
> **Type:** ADR

# ADR: Graph DB Rationale

## Version History

| Version | Date       | Author | Change Summary     | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------ | --------- | ------ | --------- |
| 0.1     | 2026-01-27 | AI     | Initial draft      | —         | Draft  | —         |
| 0.2     | 2026-01-29 | AI     | Add metadata block | —         | Draft  | —         |
| 0.3     | 2026-01-29 | AI     | Clarify decision, context, and trade-offs | — | Draft | — |

## Context

- **Problem:** Ingestion and task workflows need a stable, queryable graph API with provenance and
  deterministic exports.
- **Background:** The domain model is graph-shaped, but storage choices may evolve as scale and
  traversal needs grow.
- **Constraints:** Local-first operation, low ops overhead, deterministic ordering, and contract
  tests across backends.
- **Stakeholders:** Graph backend team, ingestion pipeline, taxonomy tooling, and CLI users.

## Decision

Separate the graph data model from storage by defining a stable `GraphStore` contract and providing
pluggable backends. Start with in-memory (tests) and embedded relational storage (SQLite), while
keeping the option to migrate to a dedicated graph database if traversal performance or ergonomics
require it.

## Alternatives Considered

- **Dedicated graph database now (e.g., Neo4j):** Strong traversal, but higher ops complexity and
  heavier deployment requirements for an MVP.
- **Key-value store + indexing:** Simple persistence, but weaker query ergonomics and custom
  indexing logic.
- **Coupled ORM schema:** Fast to implement, but reduces portability and makes export/import harder.

## Consequences

- **Benefits:** Storage-agnostic API, deterministic exports, and easier future migrations.
- **Trade-offs:** Additional abstraction layer and potential impedance mismatch for advanced
  traversals.
- **Risks:** Future migration cost if embedded storage becomes a bottleneck; mitigated by contract
  tests and JSON-LD export compatibility.
