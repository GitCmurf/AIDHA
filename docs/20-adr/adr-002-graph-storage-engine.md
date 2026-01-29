---
document_id: AIDHA-ADR-002
owner: Graph Architecture Lead
status: Draft
last_updated: 2026-01-29
version: '0.4'
title: Graph Storage Engine Selection
type: ADR
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-002
> **Owner:** Graph Architecture Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-01-29
> **Type:** ADR

## Version History

| Version | Date       | Author | Change Summary                                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Placeholder ADR created                                  | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0 (ID + metadata + filename) | —         | Draft  | —         |
| 0.3     | 2026-01-29 | AI     | Select SQLite for MVP persistence                        | —         | Draft  | —         |
| 0.4     | 2026-01-29 | AI     | Note experimental status and runtime requirements        | —         | Draft  | —         |

## Context

We need an embedded, local-first persistence option that is deterministic,
testable without network access, and simple to ship in the TypeScript toolchain.

## Decision

Use SQLite as the MVP embedded persistence engine for `GraphStore`, implemented
via Node.js `node:sqlite` (Node 22.5+). The module is experimental in current
Node 22.x and emits an `ExperimentalWarning`, so we should re-evaluate before
production hardening. Keep `InMemoryStore` as the reference implementation.
`LevelGraphStore` remains optional for legacy comparison.

## Consequences

- Requires Node 22.5+ for the built-in SQLite bindings.
- Ensure the runtime supports `node:sqlite` (some Node builds may require the
  `--experimental-sqlite` flag).
- Expect experimental warnings until the module stabilizes.
- Keeps operational complexity low (single-file DB, no external services).
- Enables deterministic ordering and indexing without extra dependencies.
