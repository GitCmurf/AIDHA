---
document_id: AIDHA-REF-006
owner: DocOps Working Group
status: Draft
last_updated: 2026-05-08
version: '0.4'
title: Repository Changelog
type: REF
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-REF-006
> **Owner:** DocOps Working Group
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-05-08
> **Type:** REF

# Repository Changelog

## Version History

| Version | Date       | Author       | Change Summary                                  | Reviewers | Status | Reference |
| ------: | ---------- | ------------ | ----------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | DocOps Agent | Initialized DocOps-aware changelog              | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF          | Adopt DocOps 2.0 ID + metadata                  | —         | Draft  | —         |
| 0.3     | 2026-02-20 | AI           | Add MVP baseline release entry and evidence refs | —         | Draft  | —         |
| 0.4     | 2026-05-08 | AI           | Document eval default and deterministic ID behavior changes | — | Draft | — |

## Entries

- **2025-11-09** – Bootstrapped DocOps tree, pnpm workspace scaffolds, MkDocs site, and validation tooling.
- **2026-02-20** – MVP baseline release evidence captured:
  - Acceptance report: `docs/55-testing/acceptance-run-20260220/testing-002-acceptance-run-20260220.md`
  - Release notes: `docs/60-devex/release-notes-001-mvp-baseline-20260220.md`
  - Baseline tag: `mvp-baseline-20260220`
- **2026-02-27** – Phase 1 and Phase 2 completion:
  - Implemented `@aidha/config` package and integrated with CLI.
  - Implemented v2 editorial ranking and quality metrics for claim extraction.
  - Resolved regression test failures and verified 200+ tests passing.
  - Completed dependency license audit (Apache 2.0 compatible).
  - Created `CONTRIBUTING_QUICK.md` for fast-path onboarding.
- **2026-05-08** – Evaluation and ID policy behavior changes:
  - Default eval embedding model changed from `gemini-embedding-2-preview` to
    `gemini-embedding-001`. Eval comparisons or caches that relied on the default may not be
    comparable across this change unless the embedding model is pinned explicitly.
  - Deterministic generated IDs now use a 128-bit SHA-256 prefix rather than a 64-bit prefix. This
    intentionally changes generated IDs and may invalidate local caches or fixtures created with
    earlier builds.

Add future entries here following semantic versioning (major.minor) and referencing tags/commits.
