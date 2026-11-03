---
document_id: RECON-REF-001
owner: Reconditum Maintainers
status: Draft
version: '0.6'
last_updated: 2026-11-03
title: Reconditum Package Docs (Pointers)
type: REF
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** RECON-REF-001
> **Owner:** Reconditum Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-11-03
> **Type:** REF

# Reconditum Package Docs (Pointers)

This folder contains **package-local** documentation for `packages/reconditum/`.

Canonical repository docs live under `docs/` and are governed by Meminit DocOps 2.0.

## Version History

| Version | Date       | Author | Change Summary                  | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-12-30 | CMF    | Create package doc stub         | —         | Draft  | —         |
| 0.2     | 2026-02-22 | AI     | Add SQLite schema views pointer | —         | Draft  | —         |
| 0.3     | 2026-05-15 | AI     | Add LevelGraph stream shim and smoke coverage | — | Draft | —         |
| 0.4     | 2026-05-15 | AI     | Document LevelGraph dependency pin rationale | — | Draft | —         |
| 0.5     | 2026-10-16 | Codex  | Specify SQLite search-index reuse on graph reopen | — | Draft | sqlite-fts.test.ts |
| 0.6 | 2026-11-03 | Codex | Include saved Knowledge content in SQLite search and older-index recovery | — | Draft | AIDHA-TESTING-097 |

## Canonical Docs

- Graph Quickstart: `../../../docs/60-devex/graph-quickstart.md`
- Graph Runbook: `../../../docs/50-runbooks/runbook-001-graph-backend.md`
- Document Standards: `../../../docs/00-governance/gov-001-document-standards.md`
- SQLite Schema Views: `./schema-views.md`

## Dependency Compatibility

`packages/reconditum` intentionally pins `classic-level@^1.4.1` and `levelgraph@^3.0.0`.

Those versions are the ones exercised by the current `LevelGraphStore` adapter and the smoke tests in `tests/levelgraph.test.ts`. The adapter in `src/store/levelgraph.ts` adds the stream and async-ready shims needed to make those versions work consistently with the current store contract.

Any future dependency bump here should be treated as a compatibility change and revalidated with the package test suite before it is accepted.

## SQLite search-index reuse

Opening a graph with a complete full-text index must not rewrite the index merely
because the graph also contains topics, propositions or review records. Only
`Claim`, `Excerpt`, `Resource` and `Knowledge` nodes belong in that index. The startup count
check compares those eligible nodes with indexed rows; it is a missing-row check,
not a full index-integrity audit.

Acceptance criteria are covered in
[`tests/sqlite-fts.test.ts`](../../tests/sqlite-fts.test.ts) and
[`tests/sqlite-knowledge-fts.test.ts`](../../tests/sqlite-knowledge-fts.test.ts): reopening a complete
index performs no row writes and preserves search results; an incomplete index
still recovers searchable content. This matters to the reader because it opens
the graph while loading saved source evidence.

Saved notes and briefs stored as `Knowledge` can be found through
`store.searchText('telescopes', ['Knowledge'])` by words in their label or content.
Omitting the type filter searches all four indexed types. Edits replace earlier
search text, and deletion removes the result. Opening an older graph through the
normal writable store backfills missing Knowledge entries without changing saved
node content or metadata; a complete index is reused. Read-only snapshot operations
do not initialise or repair indexes.

[AIDHA-TESTING-097](../../../../docs/55-testing/testing-097-knowledge-text-search.md)
specifies search, persistence, older-index recovery and no-write acceptance checks.
This backend capability does not generate notes or connect unpublished reading views
to the ingestion pipeline.

Validate with `pnpm --filter @aidha/graph-backend test` and
`pnpm --filter @aidha/graph-backend lint`.
