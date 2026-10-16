---
document_id: AIDHA-GUIDE-002
owner: Taxonomy Team
status: Draft
last_updated: 2026-10-16
version: '0.3'
title: Taxonomy Quickstart
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-002
> **Owner:** Taxonomy Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-16
> **Type:** GUIDE

## Version History

| Version | Date       | Author | Change Summary                            | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ----------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Seed placeholder quickstart               | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Adopt DocOps 2.0 ID + add Version History | —         | Draft  | —         |
| 0.3     | 2026-10-16 | Codex  | Describe durable taxonomy assignment provenance | — | Draft | packages/praecis/youtube/tests/pipeline.test.ts |

## Purpose

Explain the taxonomy assignment provenance recorded by the shared ingestion
classifier and how to validate it.

## Automatic assignment provenance

With configured taxonomy tags, the shared keyword classifier stores automatic
tag assignments on each Resource as `taxonomyAssignments`. Each new assignment
includes a `taxonomyVersion` fingerprint of the configured tag IDs, names and
aliases. Reordering tags or aliases preserves the fingerprint; changing the
matching vocabulary changes it. Repeat ingestion keeps the original assignment
and version. This is not a full taxonomy release version: category and topic
changes do not affect it.

The schema tests are `packages/phyla/tests/schema.test.ts` and
`packages/reconditum/tests/contract/schema-domain-metadata.test.ts`.
`packages/praecis/core/tests/pipeline/classifier.test.ts` checks fingerprint
identity and ordering.
`packages/praecis/youtube/tests/pipeline.test.ts` checks the exact Resource
metadata after closing and reopening SQLite;
`packages/praecis/sources/email/tests/email-pipeline.test.ts` checks the same
shared behavior for email ingestion.
