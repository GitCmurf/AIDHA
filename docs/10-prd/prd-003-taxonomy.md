---
document_id: AIDHA-PRD-003
owner: Taxonomy Product Lead
status: Draft
last_updated: 2026-01-24
version: '0.3'
title: Taxonomy
type: PRD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PRD-003
> **Owner:** Taxonomy Product Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-01-24
> **Type:** PRD

## Version History

| Version | Date       | Author | Change Summary       | Reviewers | Status | Reference |
|---------|------------|--------|----------------------|-----------|--------|-----------|
| 0.1     | 2025-11-09 | TBD    | Skeleton PRD created | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0 (ID + metadata + filename) | — | Draft | — |
| 0.3     | 2026-01-24 | Codex  | Flesh out taxonomy requirements and governance contract | — | Draft | — |

---

## Executive Summary

AIDHA needs a shared taxonomy to classify ingested resources and improve retrieval, navigation, and
prompting. The taxonomy must be stable, versioned, and validated so ingestion and graph storage can
depend on it without drift.

This PRD defines the taxonomy’s public schema (categories/topics/tags), assignment semantics, storage
expectations, and the validation/test gates required before downstream packages rely on changes.

## Problem Statement

Without a governed taxonomy:

- tags become inconsistent synonyms (low retrieval quality),
- ingestion produces noisy/duplicative labels (hard to search),
- models have no canonical vocabulary for classification,
- downstream queries and dashboards break when identifiers change.

## Objectives & Success Metrics

### Objectives

1. Provide a taxonomy data model:
   - Categories (broad buckets),
   - Topics (within categories),
   - Tags (leaf-level keywords with aliases).
2. Provide a registry interface for CRUD and lookup:
   - list by parent/category/topic,
   - find tags by alias case-insensitively,
   - assign tags to graph node IDs with optional confidence/provenance.
3. Provide validation tooling:
   - structural integrity (no orphan references),
   - identifier uniqueness,
   - consistent casing rules,
   - optional governance rules (reserved IDs, deprecations).
4. Provide a migration/versioning workflow so taxonomy evolution is safe.

### Success Metrics (MVP targets)

- Ingestion pipeline can load taxonomy tags and assign them deterministically.
- Validation catches:
  - unknown `categoryId`/`topicId` references,
  - duplicate IDs,
  - invalid alias collisions.
- Taxonomy changes are gated by tests (CI) and can be reviewed as diffs.

## Users & Use Cases

### Primary Users

- **Ingestion engine** (AIDHA-PRD-002) uses taxonomy for tagging and evaluation.
- **Human curator** adds/edits tags/topics to keep the taxonomy useful over time.
- **Agent/coding model** uses canonical tag IDs and aliases when classifying and writing prompts.

### Use Cases (MVP)

1. Create a category (e.g., "Technology") and topics (e.g., "Programming").
2. Add a tag ("react") with aliases ("reactjs", "react.js") and link it to one or more topics.
3. Given text content, match tags by name/aliases and assign them to a graph node ID.
4. Validate the taxonomy and fail CI if integrity rules are violated.

## Scope

### In Scope (MVP)

- Package: `packages/phyla/`.
- Zod schemas and TypeScript types for:
  - Category
  - Topic
  - Tag
  - TagAssignment (nodeId + tagId + optional confidence/source)
- Registry contract (CRUD + query) with at least an in-memory implementation.
- Validation utilities and tests that enforce integrity constraints.
- A documented on-disk representation strategy (Next section) even if the first implementation is
  in-memory.

### In Scope (Next)

- File-backed registry (load/save taxonomy and assignments from repo-controlled files).
- Explicit deprecation workflow (superseded tags, redirects).
- Evaluation fixtures for classification quality and regression detection.

## Out of Scope

- Ontology reasoning (OWL/RDF inference).
- Fully automatic taxonomy generation.
- Multi-user permissioning and approval workflows inside the runtime (handled via git + PR review).

## Requirements

### Functional Requirements

FR-1. **Stable identifiers**

- Category/topic/tag IDs MUST be stable strings and MUST be unique in their respective namespaces.
- Renaming `name` MUST NOT require changing `id`.
- The system MUST support aliases for tags and case-insensitive alias matching.

FR-2. **Hierarchy and relationships**

- Topics MUST reference a valid `categoryId`.
- Tags MUST reference one or more `topicIds` (MVP requirement; can be relaxed later if needed).
- Categories MAY be nested via `parentId` (optional).

FR-3. **Registry behaviors**

- Registry MUST support:
  - add/get/update/list categories,
  - add/get/update/list topics by category,
  - add/get/update/list tags by topic,
  - find tag by alias (case-insensitive),
  - assign tag to a node ID,
  - list/remove assignments for a node ID.

FR-4. **Assignment semantics**

- Assignments MUST include `nodeId` and `tagId`.
- Assignments SHOULD include:
  - `confidence` (0..1),
  - `source` (manual | automatic).
- Registry MUST prevent assignment to unknown tags.

FR-5. **Validation**

- Validation MUST detect and report:
  - references to unknown IDs (`topic.categoryId`, `tag.topicIds`, assignments),
  - duplicate IDs,
  - alias collisions (two tags sharing the same alias in a case-insensitive manner).
- Validation output MUST be machine-usable (structured errors) for CI gating.

### Non-Functional Requirements

NFR-1. **Determinism**

- List operations MUST return stable ordering (recommended: sort by `sortOrder` then `name`/`id`).

NFR-2. **Testability**

- All validation and registry operations MUST be testable without external services.

NFR-3. **Compatibility**

- The taxonomy package MUST remain usable as a pure library dependency for ingestion and graph code.

### Constraints

- Language/runtime: TypeScript, ESM.
- Keep taxonomy artifacts human-reviewable in git (when file-backed storage is introduced).

## On-Disk Representation (Required Design Output)

To enable governance via git and reproducible ingestion, the taxonomy MUST define (and document)
canonical file formats. MVP can start with:

- `taxonomy.json` (or `taxonomy.yaml`) for categories/topics/tags
- `assignments.json` for optional persisted assignments (if used)

The schema for these files MUST be validated by the same Zod schemas used at runtime.

## Acceptance Criteria (Protected by Tests)

Taxonomy is acceptable for downstream use when:

1. Schema tests pass for valid and invalid examples (rejects malformed structures).
2. Registry tests cover CRUD + lookups + alias matching.
3. Validation tests cover at least:
   - orphan topic/category references,
   - unknown tag IDs,
   - alias collisions.

Suggested test placement:

- `packages/phyla/tests/schema.test.ts`
- `packages/phyla/tests/registry.test.ts`
- `packages/phyla/tests/validation.test.ts`

## Dependencies

- AIDHA-PRD-001 (Graph Database) for how tag assignments are represented in the graph export (if/when
  represented as `taggedWith` edges).
- AIDHA-PRD-002 (Ingestion) for classifier requirements and evaluation fixtures.
- AIDHA-ADR-003 (Taxonomy Storage and Governance) for decisions on storage format, deprecations, and
  CI gating policy.

## Risks & Mitigations

- Risk: Taxonomy churn breaks ingestion or changes historical meaning.
  - Mitigation: stable IDs; deprecations/redirects; validation gates; versioned exports.
- Risk: Alias collisions create ambiguous tagging.
  - Mitigation: validation + explicit disambiguation rules; keep aliases sparse and curated.
- Risk: Overly complex taxonomy slows iteration.
  - Mitigation: start small, prefer tags with strong signal; add evaluation fixtures before expanding.

## Open Questions

1. Should tags/topics/categories also be created as graph nodes (to allow graph-native traversal and
   JSON-LD export), or stay as an external registry?
2. Should assignments be persisted separately, embedded into graph edges, or both?
3. What is the deprecation workflow (redirect tags vs. hard removal) and what are the guarantees for
   historical data?
