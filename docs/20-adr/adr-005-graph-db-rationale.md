---
document_id: AIDHA-ADR-005
type: ADR
title: Graph DB Rationale
status: Draft
version: "0.2"
last_updated: "2026-01-29"
owner: __TBD__
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-ADR-005
> **Owner:** **TBD**
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-01-29
> **Type:** ADR

# ADR: Graph DB Rationale

## Version History

| Version | Date       | Author | Change Summary     | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------ | --------- | ------ | --------- |
| 0.1     | 2026-01-27 | AI     | Initial draft      | —         | Draft  | —         |
| 0.2     | 2026-01-29 | AI     | Add metadata block | —         | Draft  | —         |

## Context

Separation of graph data model and storage.

## Content

The domain model for both knowledge and tasks is graph-shaped. We want a
storage-agnostic graph API that supports fluid creation and discovery of
dependencies, deterministic export, and efficient neighborhood/path queries.
Backend choice can start with an embedded relational store and evolve if
traversal performance or ergonomics require a dedicated graph database.
