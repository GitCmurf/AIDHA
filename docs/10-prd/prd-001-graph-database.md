---
document_id: AIDHA-PRD-001
owner: Graph Backend Product Lead
status: Draft
last_updated: 2026-01-29
version: "0.5"
title: Graph Database
type: PRD
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PRD-001
> **Owner:** Graph Backend Product Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.5
> **Last Updated:** 2026-01-29
> **Type:** PRD

## Version History

| Version | Date       | Author | Change Summary                                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ---------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Skeleton PRD created                                       | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0 (ID + metadata + filename)   | —         | Draft  | —         |
| 0.3     | 2026-01-24 | Codex  | Flesh out requirements, contracts, and acceptance criteria | —         | Draft  | —         |
| 0.4     | 2026-01-28 | CMF    | Tasks graph requirements (future)                          | —         | Draft  | —         |
| 0.5     | 2026-01-29 | AI     | Align contract to upserts + SQLite backend                 | —         | Draft  | —         |

---

## Executive Summary

AIDHA needs a local-first, deterministic cognition graph backend to store knowledge
items and their relationships, power ingestion pipelines, and export interoperable
graph snapshots (JSON-LD) for downstream tools and AI retrieval.

This PRD defines the **public contracts** for the graph backend: node/edge schemas,
storage behavior, query expectations, export requirements, and the tests that must
protect these behaviors.

## Problem Statement

Today we can extract information (e.g., from transcripts) but lack a stable, queryable, and
exportable graph store that:

- keeps data locally (first tests) or safely in the cloud (e.g., neo4j) (personal knowledge base),
- preserves provenance (where a claim came from),
- represents relationships (references/derivations/tags),
- exports deterministically (so diffs and CI checks are meaningful),
- is safe to build other packages on (taxonomy + ingestion depend on stable contracts).

## Objectives & Success Metrics

### Objectives

1. Provide a **GraphStore** contract with at least two implementations:
   - in-memory (tests/dev),
   - embedded persistent store (local disk, SQLite)
   - extensible to support other stores (e.g., neo4j).
2. Provide **schema-first validation** (reject invalid nodes/edges at boundaries).
3. Provide a **deterministic JSON-LD export** suitable for downstream indexing and diffs.
4. Provide a **contract test suite** that any GraphStore implementation must pass.

### Success Metrics (MVP targets)

- Contract tests run in CI and pass for all supported stores (`pnpm -r test`).
- JSON-LD export for a given graph state is stable across runs (byte-identical after sorting rules
  defined below).
- Node/edge CRUD operations behave consistently across store backends.
- Supports at least 10k nodes / 50k edges in a local store without pathological slowdown
  (informal dev benchmark is acceptable for Draft status).

## Users & Use Cases

### Primary Users

- **Ingestion pipeline** (AIDHA-PRD-002): writes Resource/Knowledge nodes and edges,
  queries by type, exports snapshots.
- **Taxonomy + classification** (AIDHA-PRD-003): writes tagging relationships and/or metadata.
- **Human operator / developer**: runs local commands to inspect/export/validate.

### Key Use Cases

1. Store a YouTube video as a Resource node with transcript content and provenance metadata.
2. Link resources together (derivedFrom, references) and attach tags (taggedWith).
3. Export an interoperable JSON-LD snapshot for a specific workspace and diff it in git.
4. Query a subset of nodes/edges (by type or edge filters) for downstream processing.

## Scope

### In Scope (MVP)

- TypeScript package: `packages/reconditum/` (published as a workspace dependency).
- Node schema + edge schema with explicit enums for `NodeType` and `Predicate`.
- GraphStore interface supporting:
  - `upsertNode`, `getNode`, `queryNodes`, `deleteNode`
  - `upsertEdge`, `getEdges`
  - `exportSnapshot`
  - `close`
- Two stores:
  - in-memory (reference implementation; simplest semantics),
  - embedded persistence (single-process local store, SQLite).
- JSON-LD export:
  - deterministic serialization rules (see Requirements).
- Contract tests:
  - a shared test suite that validates behavior across store implementations.

### In Scope (Next)

- HTTP API wrapper around GraphStore (read/write), **without** locking the repository into a
  particular server framework.
- Import pipeline (read a JSON-LD snapshot and merge/replace).
- Index primitives: basic full-text search over `label`/`content` (optional).

## Out of Scope

- Distributed/multi-writer graph database, clustering, or online sync.
- Cypher/SPARQL query engines (we use simple query filters for MVP).
- Fine-grained ACLs / multi-user auth (local-first assumption).
- LLM reasoning inside the graph backend (done in ingestion/agent layers).

## Requirements

### Functional Requirements

FR-1. **Schema validation at boundaries**

- All node/edge creates and updates MUST validate against the exported Zod schemas.
- Invalid inputs MUST return a structured failure (`Result` with `ok: false`) and MUST NOT mutate
  the store.

FR-2. **Node identifiers**

- Node IDs are caller-provided strings (no hidden ID generation in the store layer).
- Stores MUST preserve IDs exactly and MUST reject empty IDs.
- Updates MUST NOT allow changing the ID.

FR-3. **Timestamps**

- Stores MUST set `createdAt` and `updatedAt` on create.
- Stores MUST preserve `createdAt` on update and refresh `updatedAt`.
- All timestamps MUST be ISO 8601 datetime strings.

FR-4. **Edge semantics**

- Edges are RDF-like triples: `(subject) -[predicate]-> (object)`.
- `predicate` MUST be one of the approved `Predicate` enum values.
- Edge uniqueness rules MUST be defined and enforced consistently:
  - MVP: A store MAY allow duplicate triples, but contract tests MUST define expected behavior.
  - Preferred: treat `(subject, predicate, object)` as unique and de-duplicate on create.

FR-5. **Query behavior**

- `queryNodes({ type })` MUST return only nodes of that type.
- `queryNodes({ limit, cursor })` MUST apply pagination deterministically.
- `queryNodes({ sort })` MUST apply stable ordering for pagination.
- `getEdges({ subject, predicate, object, limit })` MUST filter and limit results.

FR-6. **Deletion behavior**

- `deleteNode(id, { cascade })` MUST remove the node.
- When `cascade: true`, edges referencing the node MUST be removed.
- When `cascade` is omitted or false, dangling edges MAY remain.

FR-7. **JSON-LD export**

- The export MUST include a stable `@context` and `@graph` array of nodes.
- Node `metadata` fields MUST be included in JSON-LD output (namespaced by the export rules).
- Edges MUST be represented as relationship properties on source nodes (per predicate).

FR-8. **Idempotent upserts**

- `upsertNode(..., { detectNoop: true })` MUST no-op when input matches stored data.
- When no-op, `updatedAt` MUST NOT change.
- `upsertEdge(..., { detectNoop: true })` MUST no-op when metadata is unchanged.

### Non-Functional Requirements

NFR-1. **Determinism**

- Export ordering MUST be stable:
  - `@graph` MUST be sorted by node `@id` ascending (lexicographic).
  - Relationship properties that are arrays MUST be sorted lexicographically.

NFR-2. **Local-first**

- Persistent store MUST be file-based and run without external services.

NFR-3. **Testability**

- All core behavior MUST be testable without network access.
- Store implementations MUST share the same contract suite.

NFR-4. **Interoperability**

- JSON-LD MUST be valid JSON-LD (context + graph) and avoid leaking internal storage artifacts.

### Constraints

- Language/runtime: TypeScript, ESM.
- Keep dependencies minimal; prefer embedded stores (no Docker dependency for MVP).
- All externally visible types should be exported from the package root.

## Public Contracts (What Coding Models Implement Against)

### Data Model (MVP)

- Node types: `Knowledge`, `Concept`, `Resource`, `Person`, `Topic`, `Excerpt`, `Claim`,
  `Reference`, `Area`, `Goal`, `Project`, `Task`, `TopicTag`
- Predicates: `relatedTo`, `partOf`, `references`, `derivedFrom`, `createdBy`, `taggedWith`,
  `supersedes`, `resourceHasExcerpt`, `claimDerivedFrom`, `claimMentionsReference`, `aboutTag`,
  `taskMotivatedBy`, `taskPartOfProject`, `projectServesGoal`, `projectInArea`, `taskDependsOn`

### Required Store Implementations

- `InMemoryStore`: reference semantics; used by tests and other packages.
- `SQLiteStore`: persists to local disk; must pass the same contract tests.
- `LevelGraphStore` is optional and must also pass the contract suite if kept.

### Export Contract

- Provide:
  - `toJsonLd(nodes, edges?) -> JsonLdDocument`
  - `serializeJsonLd(doc, pretty?) -> string`
- Export MUST be deterministic per NFR-1.

## Acceptance Criteria (Protected by Tests)

The graph backend is acceptable for downstream packages when:

1. Store contract tests pass for in-memory and persistent stores.
2. JSON-LD export is deterministic (snapshot/fixture test).
3. CRUD and query behaviors match the contract and are consistent across stores.

Suggested test placement (can evolve):

- `packages/reconditum/tests/contract/*.test.ts` for shared store contract tests.
- `packages/reconditum/tests/export.test.ts` includes determinism fixtures for JSON-LD output.

## Dependencies

- AIDHA-ADR-002 (Graph Storage Engine Selection) for persistent storage decisions.
- AIDHA-PRD-003 (Taxonomy) for tagging contract expectations.
- AIDHA-PRD-002 (Ingestion) for required node/edge shapes and provenance metadata.

## Risks & Mitigations

- Risk: Schema churn breaks ingestion/taxonomy.
  - Mitigation: contract tests + explicit versioning; deprecate fields gradually.
- Risk: Non-deterministic ordering in exports makes diffs noisy.
  - Mitigation: explicit sorting rules and fixture tests.
- Risk: Persistent store semantics diverge from in-memory store.
  - Mitigation: shared contract suite with both implementations.

## Open Questions

1. Do we enforce edge uniqueness at create time (recommended) or allow duplicates?
2. Should deleting a node cascade delete referencing edges (recommended) or leave dangling edges?
3. Should tags/topics live as graph nodes (exportable) or remain external (taxonomy registry only)?

## Tasks graph requirements (future)

- Edge type constraints: dependsOn edges can only connect Task -> Task
- Cycle detection: inserting dependsOn must reject cycles (or mark plan invalid)
- Scheduling semantics: edge metadata includes dependency type + lag; tasks include
  duration/effort/earliest start constraints
- Versioning: snapshots or “plans” as first-class (otherwise fluid discovery becomes
  “everything is always changing” and you can’t reason about it)

## Appendix

- Package implementation lives in `packages/reconditum/`.
- This PRD defines _minimum contracts_; feature designs (HTTP API, import/merge
  strategies) belong in ADRs/FDDs once the MVP stabilizes.
