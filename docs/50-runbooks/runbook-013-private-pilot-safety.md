---
document_id: AIDHA-RUNBOOK-013
owner: Product
status: Draft
last_updated: 2026-10-16
version: '0.1'
title: Private Pilot Safety Operations
type: RUNBOOK
docops_version: '2.0'
area: CORE
keywords: [pilot, security, public, privacy, acceptance]
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-006]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-013
> **Owner:** Product
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-16
> **Type:** RUNBOOK

# Runbook: Private Pilot Safety Operations

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-10-16 | AI     | Define private pilot storage and tracked-path checks. | — | Draft | AIDHA-PLAN-015 |

## Purpose

Keep evidence from real personal sources out of the public repository. Public acceptance packets
may contain deterministic fixtures and mock outputs. A public pilot summary requires manual
sanitization. Raw private pilot material belongs outside Git.

| Material | Where it belongs |
| -------- | ---------------- |
| Synthetic fixture inputs, mock transcripts, deterministic outputs | Public acceptance packet after review |
| Generalized findings without source text or identifiers | Public summary after manual review |
| Real files, emails, bookmarks, playlists, transcripts, graph exports, model outputs, screenshots, or local paths | Private storage outside the repository |

## Private Pilot Workflow

1. Copy [the pilot evidence template](../55-testing/testing-006-viable-prototype-pilot-evidence-template.md)
   to private storage. Do not put the completed copy under `docs/55-testing/`.
2. Keep raw commands, stores, exports, dossiers, screenshots, and model responses in private storage.
   If temporary storage inside the working tree is unavoidable, use an ignored local-only directory
   such as `__Local__Do_Not_Commit/`, `Personal/`, or `testdata/nonredistributable/`.
   All three paths are listed in `.gitignore`.
3. Before publishing a summary, remove or generalize private source text and URLs, email addresses,
   account and project names, local paths, service identifiers, credentials, and screenshots.
4. Review the exact staged diff and tracked file list before pushing. Run the checks below.

Project-local `.aidha/config.yaml` and user-local `~/.config/aidha/config.yaml` may contain private
paths or service settings. Keep both out of commits. The guard also rejects tracked copies under
`.config/aidha/config.yaml` and backup variants. Only the exact
`.aidha/config.yaml.example` and `.config/aidha/config.yaml.example` names are exempt; review their
contents before publication.

## Path Guard and Verification

The guard rejects tracked paths that look like private pilot packets, local-only directories,
configuration, credentials, or generated output. It permits synthetic acceptance packet paths.
The checks in `scripts/test-public-safety.mjs` cover both cases, including force-staged ignored
files and unusual filenames.

```bash
pnpm security:public-paths:test
pnpm security:public-paths
git status --short
git diff --cached --check
git diff --cached
pnpm docs:build
```

The path guard uses `git ls-files`: it checks tracked **names**, not file contents. It cannot certify
that a synthetically named file contains only synthetic data. Review the contents of every staged
acceptance artifact and public summary; run the repository's secret scan as an additional check.

If a private file was staged, unstage it with `git restore --staged <path>` without deleting the
working copy, move it outside the repository, and rerun the checks. If a private artifact has already
been published, stop publication work and handle exposure and any affected credentials directly.
