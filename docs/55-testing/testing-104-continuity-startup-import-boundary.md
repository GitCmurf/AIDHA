---
document_id: AIDHA-TESTING-104
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-11-04
title: Manual Continuity Startup Import Boundary
type: TESTING
docops_version: '2.0'
area: CLI
related_ids: [AIDHA-PRD-004, AIDHA-TESTING-088, AIDHA-TESTING-091]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-104
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-11-04
> **Type:** TESTING

# Manual Continuity Startup Import Boundary

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-04 | Codex | Recorded manual continuity startup acceptance and its public CLI import check. | — | Draft | AIDHA-PRD-004; AIDHA-TESTING-088; AIDHA-TESTING-091 |

## Scope

Manual continuity commands must run through the built public `aidha` executable without importing
the bare `@aidha/praecis-core` package root or `compromise`. This covers command help,
capture/update schemas and the local `capture → show → update → show` workflow. It is an
import-graph contract, not a startup-time target.

Continuity imports the existing APIs through `@aidha/praecis-core/continuity`. This public subpath
exposes the existing schema, validation, persistence and rendering module. It adds no interpretation
or provider behaviour. The product scope remains bounded by
[AIDHA-PRD-004](../10-prd/prd-004-continuity-capture.md), with functional acceptance in
[AIDHA-TESTING-088](testing-088-continuity-capture.md). General lightweight CLI startup acceptance
remains in [AIDHA-TESTING-091](testing-091-cli-startup-import-boundary.md).

## Acceptance

The
[CLI startup-boundary test](https://github.com/GitCmurf/AIDHA/blob/main/packages/praecis/cli/tests/startup-import-boundary.test.ts)
launches the built public executable with a Node ESM loader that rejects both the bare core package
root and `compromise` for continuity commands.

- Continuity help and both capture/update input schemas succeed under that restriction.
- Separate child processes capture a fictional account, read it back, correct a fact and read it
  back again. Readback retains both source accounts and the event history, changes the named fact,
  and preserves the unrelated fact.
- The existing ingest negative control still attempts to import `compromise` and fails with the
  loader's NLP rejection. Ingest continues to use its existing ingestion runtime.

All fixtures are temporary and local. The tests make no network calls and do not use model
providers. The import check is enabled on Node versions that support the repository's read-only
SQLite snapshot API.

## Verification

Build the CLI dependency closure before running the targeted checks:

```bash
pnpm --filter @aidha/praecis-cli... build
pnpm --filter @aidha/praecis-cli exec vitest run tests/startup-import-boundary.test.ts
pnpm --filter @aidha/praecis-core exec vitest run tests/continuity/case.test.ts
pnpm --filter @aidha/praecis-core lint
pnpm --filter @aidha/praecis-cli lint
node scripts/meminit-check.mjs docs/55-testing/testing-091-cli-startup-import-boundary.md docs/55-testing/testing-104-continuity-startup-import-boundary.md
pnpm docs:build
```

The local targeted checks recorded nine startup-boundary passes and 28 core continuity passes.
All eight CLI test files produced completed results across bounded runs: 100 passed and one expected
unsupported-runtime skip. The single full-suite command with `--maxWorkers=1` reached its
unchanged 300-second outer guard and exited 124; it is not a passing full-suite invocation. The
remaining files subsequently completed in bounded groups. No tracked test timeout was increased.

Review evidence records the exact commands, results and environment limitations. These checks
establish the import boundary for the tested fixtures; they make no latency claim.
