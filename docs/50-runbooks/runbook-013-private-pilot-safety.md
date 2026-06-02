---
document_id: AIDHA-RUNBOOK-013
owner: Product
status: Draft
last_updated: 2026-06-02
version: '0.1'
title: Private Pilot Safety Operations
type: RUNBOOK
docops_version: '2.0'
area: CORE
keywords: [pilot, security, public, privacy, acceptance]
related_ids: [AIDHA-PLAN-008, AIDHA-TASK-010, AIDHA-TESTING-005, AIDHA-TESTING-006]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-013
> **Owner:** Product
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-06-02
> **Type:** RUNBOOK

# Runbook: Private Pilot Safety Operations

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-06-02 | AI     | Add private pilot safety boundary and pre-push checks for public repo work. | — | Draft | AIDHA-TASK-010 |

## Purpose

This runbook separates public, commit-safe prototype evidence from private pilot material generated
with personal files, chosen playlists, bookmarks, email, local folders, or live service accounts.
The default rule is conservative: public artifacts must be reproducible with deterministic fixtures
or explicitly sanitized summaries; private artifacts stay outside Git or under ignored local-only
paths.

## Public and Private Lanes

| Lane | Commit policy | Examples |
| ---- | ------------- | -------- |
| Public acceptance | Commit-safe when generated from deterministic fixtures and mock services. | `docs/55-testing/acceptance-run-YYYYMMDD/`, fixture PDFs, mock graph exports, command transcripts with no private paths. |
| Public pilot summary | Commit-safe only after manual sanitization. | A short pass/fail summary, defect list, generalized project labels, and anonymized IDs. |
| Private pilot evidence | Do not commit. | Personal source files, real playlists, bookmarks, email, browser exports, raw transcripts, local store paths, API responses, model cache outputs, and screenshots of private data. |

## Safe Storage Locations

Prefer storing private pilot runs outside the repository. If a run must live temporarily inside the
repo working tree, use ignored local-only locations such as:

- `__Local__Do_Not_Commit/`
- `Personal/`
- `CMF/`
- `secrets/`
- `out/`
- `testdata/youtube_local/`
- `testdata/nonredistributable/`

Project-local configuration belongs in `.aidha/config.yaml`; user-local configuration belongs in
`~/.config/aidha/config.yaml`. Both may contain private paths or service settings and must not be
committed.

## Private Pilot Workflow

1. Start from a clean working tree or record unrelated work before beginning.
2. Copy AIDHA-TESTING-006 into private storage, not into a committed `docs/55-testing/pilot-run-*`
   directory.
3. Run the two-project pilot against the private source set.
4. Keep raw command transcripts, stores, graph exports, dossiers, screenshots, and model outputs in
   private storage.
5. Create a public summary only after sanitization, using abstract project labels and non-sensitive
   evidence.
6. Run the pre-push safety checks before staging or committing any pilot result.

## Sanitization Rules

Remove or generalize all private source text, source URLs, playlist IDs, bookmark URLs, email
addresses, message IDs, private project names, local filesystem paths, store paths, account names,
cookies, tokens, API keys, generated cache identifiers, and screenshots containing private content.

Use labels such as `dormant-project-a`, `active-project-b`, `source-1`, and `task-from-claim-1`.
Retain the behavioral conclusion, defect class, command path, and reproduction notes only when they
do not reveal the underlying private material.

## Pre-Push Public Safety Checks

Run these before intentionally publishing pilot-related work:

```bash
git status --short
pnpm security:public-paths
detect-secrets scan --all-files
rg -n "api[_-]?key|token|secret|password|cookie|playlist|bookmark|gmail|email|linkedin|youtube|/home/|/Users/|C:\\\\" docs packages scripts
pnpm test
pnpm docs:build
```

The `rg` command is a review aid, not a zero-hit gate. Governed docs and examples may contain
non-sensitive placeholder terms; real private source details must not appear in committed files.

## Workspace Count Note

`pnpm test` may print `Scope: 19 of 20 workspace projects`. That is expected when the private root
package is counted in the workspace listing while recursive package test scripts run across the 19
package workspaces. `scripts/check-test-scripts.mjs` remains the explicit gate that every package
workspace defines `test:ci`.

## If Private Material Is Staged

Do not commit. Unstage without deleting the local copy:

```bash
git restore --staged <path>
```

Move the file outside the repository or into an ignored local-only directory, then rerun the safety
checks. If private material was already committed, stop normal work and rotate any exposed secrets
before rewriting history or opening a public PR.

## What Can Be Public

- Deterministic fixture inputs and outputs.
- Mock service transcripts.
- Acceptance packets under `docs/55-testing/acceptance-run-*`.
- Sanitized pilot summaries that omit private source details.
- Defect classes, command names, and reproducible steps that do not identify private sources.

## What Must Stay Private

- Raw personal files, emails, bookmarks, playlists, transcripts, screenshots, and source exports.
- Local store directories, database snapshots, graph dumps, and model cache outputs from private
  runs.
- Service credentials, cookies, tokens, account IDs, and machine-local paths.
- Any artifact that lets a reader reconstruct the private corpus or identify the operator's
  personal source set.
