---
document_id: AIDHA-TESTING-087
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-18
title: Ignore Generated Meminit Lock Files
type: TESTING
docops_version: '2.0'
area: DOCS
related_ids: [AIDHA-GOV-001]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-087
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Ignore Generated Meminit Lock Files

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify repository ignore behavior for generated Meminit lock files. | — | Draft | — |
| 0.2 | 2026-10-18 | Codex | Remove the previously tracked generated lock and verify it stays untracked. | — | Draft | — |

## Scope

Meminit may create a `.meminit.lock` file beside the task data it is coordinating. These empty
coordination files are transient local state and must not appear as source changes. A repository
ignore rule does not affect files already tracked by Git, so this change removes the previously
tracked `docs/05-planning/tasks/.meminit.lock`. The ignore rule then prevents generated instances
from being added again at any directory depth. It does not ignore similarly named authored files
or change the existing `.meminit/cache/` rule.

## Acceptance and verification

- `docs/05-planning/tasks/.meminit.lock` is absent from the Git index after removal of the
  previously tracked file.
- Git reports the repository `.gitignore` rule as the matching rule for root-level and nested
  generated `.meminit.lock` paths.
- A similarly named authored path such as `docs/05-planning/tasks/.meminit-lock-notes.md` remains
  visible to Git.
- Existing `.meminit/cache/` paths remain ignored.
- Run `pnpm docs:build` to regenerate the catalog, validate governed metadata, and build the strict
  MkDocs site.
- Run the scoped DocOps check for this file:

  ```sh
  node scripts/meminit-check.mjs docs/55-testing/testing-087-meminit-lock-ignore.md
  ```
