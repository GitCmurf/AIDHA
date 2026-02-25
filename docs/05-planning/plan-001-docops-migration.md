---
document_id: AIDHA-PLAN-001
owner: Repo Maintainers
status: Draft
version: '0.2'
last_updated: 2026-02-24
title: DocOps Brownfield Migration Plan
type: PLAN
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PLAN-001
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-02-24
> **Type:** PLAN

# DocOps Brownfield Migration Plan

This plan tracks the repo’s migration onto Meminit DocOps 2.0 compliance gates.

## Version History

| Version | Date       | Author | Change Summary               | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ---------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-12-27 | CMF    | Create migration plan record | —         | Draft  | —         |
| 0.2     | 2026-02-24 | AI     | Update nav source-of-truth reference (`mkdocs.yml`) | — | Draft | — |

## Goals

- Make `pre-commit` a reliable local proxy for CI gates.
- Bring `docs/` into DocOps 2.0 compliance (front matter, IDs, filenames, index artifacts).
- Keep scratch work out of the governed tree (use untracked WIP notes instead).

## Safety Rules

- Use `meminit doctor` and `meminit check` as read-only truth.
- Use `meminit fix --dry-run` before any write operations.
- Keep changes small and validate frequently.

## Current Work Items

- Resolve remaining `meminit check` violations in `docs/`.
- Update MkDocs nav (`mkdocs.yml`) after renames.
- Regenerate indices (`docs/01-indices/catalog.json`) and validate schema.
