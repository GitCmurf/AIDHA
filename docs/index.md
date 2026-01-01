---
document_id: AIDHA-OVERVIEW-001
owner: Repo Maintainers
status: Draft
last_updated: 2025-12-27
version: '0.2'
title: AIDHA Workspace Documentation
type: OVERVIEW
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-OVERVIEW-001
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2025-12-27
> **Type:** OVERVIEW

# AIDHA Workspace Documentation

Welcome to the MkDocs-powered documentation portal. Content mirrors the numeric directory tree in
`docs/` and the pnpm workspace packages:

- Governance lives under `00-governance/` (standards, style guides, taxonomy).
- Product/engineering artifacts (PRDs/ADRs/FDDs) live under the numbered folders (10-, 20-, 30-, ...).
- Package-specific quickstarts/runbooks reside next to their code but are surfaced through navigation
  for convenience.

## Version History

| Version | Date       | Author | Change Summary                   | Reviewers | Status | Reference |
|---------|------------|--------|----------------------------------|-----------|--------|-----------|
| 0.1     | 2025-11-09 | TBD    | Initial docs portal landing page | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0    | —         | Draft  | —         |

## Editing Workflow

1. Run `pnpm docs:serve` to preview the site locally.
2. Every governed change under `docs/` follows Meminit DocOps 2.0; see
   `00-governance/gov-001-document-standards.md`.
3. Before merging, run `pnpm docs:build` to ensure the site compiles.

## Next Steps

- Flesh out PRDs/ADRs/FDDs with real content.
- Add search enhancements (Material built-in) and versioning via `mike` when needed.
- Automate catalog generation into `docs/01-indices/catalog.json` for agent/RAG consumption.
