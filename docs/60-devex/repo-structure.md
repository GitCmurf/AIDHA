---
document_id: AIDHA-REF-003
owner: DocOps Working Group
approvers: CMF
status: Draft
last_updated: 2026-02-24
version: '0.3'
title: Repository Structure
type: REF
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-REF-003
> **Owner:** DocOps Working Group
> **Approvers:** CMF
> **Status:** Draft
> **Last Updated:** 2026-02-24
> **Version:** 0.3
> **Type:** REF

# Repository Structure

## Version History

| Version | Date       | Author | Change Summary                            | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ----------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Seed repository structure overview        | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Adopt DocOps 2.0 ID + add Version History | —         | Draft  | —         |
| 0.3     | 2026-02-24 | AI     | Update MkDocs nav reference (`mkdocs.yml`) | — | Draft | — |

## Top-Level Directories

| Path                 | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `docs/`              | Numeric DocOps tree (00–99) + nav/templates/scripts     |
| `specs/<id>-<slug>/` | SpecKit-generated artifacts for in-flight work          |
| `packages/`          | pnpm workspace packages (reconditum, phyla, praecis)    |
| `.specify/`          | SpecKit CLI templates/scripts (do not modify structure) |
| `.codex/prompts/`    | Prompt experiments, agent guidance                      |
| `styles/`            | Vale rules, Markdownlint config, future design tokens   |

## Packages

Each package lives under `packages/<name>/` with:

```text
src/        # implementation
tests/      # unit + contract tests
docs/       # local notes (pointers to canonical docs)
ops/        # local ops notes (pointers to canonical runbooks)
prompts/    # AI prompt suites + evaluations
README.md   # package overview + links to canonical PRD/ADR/runbook
```

Promote reusable logic into dedicated packages before referencing across features. For future apps
(e.g., private/internal vs. public), follow the same workspace pattern: `apps/<app-name>/` with
`src/`, `tests/`, and `docs/` plus links into the DocOps tree.

## SpecKit Flow

1. Use `bash .specify/scripts/bash/create-new-feature.sh` to scaffold a spec.
2. Keep work inside `specs/<id>-<slug>/` until it graduates; then merge reusable code into
   `packages/` and move docs into the numeric tree.

## Naming & Evolution

- `src/components`, `src/features`, `src/lib`, `src/shared` are acceptable inside packages/apps, but
  favor package-level boundaries for shared logic to keep imports explicit.
- When adding new domains, reserve a Document ID prefix (e.g., `MEMO-PRD`).
- For future public packages/apps, extend `pnpm-workspace.yaml` and update this document plus `mkdocs.yml`.
