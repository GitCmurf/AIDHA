---
document_id: AIDHA-TESTING-080
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Node Runtime Floor
type: TESTING
docops_version: '2.0'
area: DOCS
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-080
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Node Runtime Floor

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Set the declared Node minimum to the first verified compatible release. | — | Draft | — |

## Scope

The root workspace and `@aidha/graph-backend` declare Node.js `>=22.12.0`. This corrects the
previous `>=22.5.0` declaration: a focused graph-store reproduction on Node 22.5.0 showed that
`SQLiteStore.upsertNode` in `packages/reconditum/src/store/sqlite.ts` receives a null-valued row
when `StatementSync.get()` finds no match, then fails schema validation. This behavior was
reproduced against the pre-existing code and was not introduced by another change. The correction
records a runtime compatibility requirement; it does not change graph-store behavior or claim a
production impact.

On this branch, the unchanged graph-backend implementation and its full existing suite passed
all 156 tests on Node 22.12.0 with `NODE_OPTIONS=--experimental-sqlite`. A separate empty-result
control also passed on the host runtime, Node 22.21.1. Node documents the required early-22.x
flag in the [v22.12.0 SQLite API](https://nodejs.org/docs/v22.12.0/api/sqlite.html).
These checks establish 22.12.0 as a verified working minimum for the exercised paths. They do
not certify every Node release, platform, or invocation configuration above that floor.

## Acceptance and verification

- Confirm the declared minimum is `>=22.12.0` in the root manifest and graph-backend manifest.
- Run the focused SQLite empty-result reproduction on Node 22.5.0 with
  `--experimental-sqlite`; verify it reports a null-valued row and `upsertNode` validation failure.
- In `packages/reconditum`, use Node 22.12.0 and run:

  ```bash
  NODE_OPTIONS=--experimental-sqlite node --experimental-sqlite node_modules/vitest/vitest.mjs run
  ```

  Verify all 156 existing tests pass with no skips.
- Run the scoped DocOps check and `pnpm docs:build`.

The runtime reproduction and suite runs are the compatibility evidence. The metadata change does
not add a compatibility shim or install or modify a runtime.
