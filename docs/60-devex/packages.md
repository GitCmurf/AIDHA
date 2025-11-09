---
document_id: AIDHA-REF-001
owner: Developer Experience Lead
status: Draft
last_updated: 2026-01-27
version: '0.4'
title: Package READMEs
type: REF
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-REF-001
> **Owner:** Developer Experience Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-01-27
> **Type:** REF

# Package Readmes

## Version History

| Version | Date       | Author | Change Summary                                   | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------------ | --------- | ------ | --------- |
| 0.2     | 2025-12-27 | CMF    | Seed package README index                        | —         | Draft  | —         |
| 0.3     | 2025-12-27 | CMF    | Adopt DocOps 2.0 ID + add Version History        | —         | Draft  | —         |
| 0.4     | 2026-01-27 | Codex  | Link to in-docs quickstarts (MkDocs strict-safe) | —         | Draft  | —         |

Each pnpm workspace package maintains a README under `packages/<name>/README.md` for local context.

For MkDocs, link to the governed docs pages (so `mkdocs build --strict` stays green). Key links:

- Graph backend: [Graph Backend Quickstart](graph-quickstart.md) (AIDHA-GUIDE-001).
  Package README: `packages/reconditum/README.md`.
- Taxonomy: [Taxonomy Quickstart](taxonomy-quickstart.md) (AIDHA-GUIDE-003).
  Package README: `packages/phyla/README.md`.
- Ingestion: [Ingestion Quickstart](ingest-quickstart.md) (AIDHA-GUIDE-002).
  Package README: `packages/praecis/youtube/README.md`.

Use these files for short-lived implementation notes, but treat the numbered `docs/` tree as the
source of truth for product/architecture/runbook content.
