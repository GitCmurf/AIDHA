---
document_id: PHYLA-REF-001
owner: Phyla Maintainers
status: Draft
version: '0.2'
last_updated: 2026-10-16
title: Phyla Package Docs (Pointers)
type: REF
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** PHYLA-REF-001
> **Owner:** Phyla Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-16
> **Type:** REF

# Phyla Package Docs (Pointers)

This folder contains **package-local** documentation for `packages/phyla/`.

Canonical repository docs live under `docs/` and are governed by Meminit DocOps 2.0.

## Version History

| Version | Date       | Author | Change Summary          | Reviewers | Status | Reference |
|---------|------------|--------|-------------------------|-----------|--------|-----------|
| 0.1     | 2025-12-30 | CMF    | Create package doc stub | —         | Draft  | —         |
| 0.2     | 2026-10-16 | Codex  | Document taxonomy version on automatic assignments | — | Draft | packages/phyla/tests/schema.test.ts |

## Canonical Docs

- Taxonomy Quickstart: `../../../docs/60-devex/taxonomy-quickstart.md`
- Document Standards: `../../../docs/00-governance/gov-001-document-standards.md`

## Assignment version provenance

`TagAssignment.taxonomyVersion` is an optional nonempty string. The shared
keyword classifier writes a fingerprint of the configured tag IDs, names and
aliases when it creates an automatic assignment. Tag and alias ordering does
not change the fingerprint; changing the matching vocabulary does. The graph
stores that value in each Resource's `taxonomyAssignments` metadata, so a fresh
store can read the version that produced the assignment. Existing assignments
retain their original value on repeat ingestion; manual and imported assignments
may omit it.

The fingerprint identifies the matching tag vocabulary. It does not represent
category or topic changes, and it is not a full taxonomy release version.
Schema acceptance is covered by `packages/phyla/tests/schema.test.ts` and
`packages/reconditum/tests/contract/schema-domain-metadata.test.ts`;
`packages/praecis/core/tests/pipeline/classifier.test.ts` checks fingerprint
identity and ordering. Durable
ingestion is covered by `packages/praecis/youtube/tests/pipeline.test.ts` and
`packages/praecis/sources/email/tests/email-pipeline.test.ts`.
