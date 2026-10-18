---
document_id: AIDHA-TESTING-091
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: CLI Startup Import Boundary
type: TESTING
docops_version: '2.0'
area: CLI
related_ids: [AIDHA-TESTING-078, AIDHA-TESTING-089]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-091
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# CLI Startup Import Boundary

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Define the lightweight CLI command import boundary and regression checks. | — | Draft | — |

## Scope

The public `aidha` executable must run `--help`, `config explain`, and JSON-LD graph export
without importing the core NLP dependency. This is an import-graph contract, not a startup-time
target. Ingest commands continue to load the existing ingestion runtime and its NLP dependency.

The lightweight command path uses the shared source-registration set and config resolver. It must
retain registered-source validation, config-selection guards, source IDs, and help usage. Provider
package roots continue to expose their existing registrations and ingestion APIs.

## Acceptance

The CLI startup-boundary test launches the built public executable with a Node ESM loader that
rejects `compromise`. It verifies successful help, graph export from a temporary SQLite fixture,
and config explanation. It also checks that the shared registration set rejects an invalid source
config and that the ingest route still attempts to load the NLP dependency.

All fixtures are temporary and local. The tests make no network calls and do not use model
providers. The import check is enabled on Node versions that support the repository's read-only
SQLite snapshot API.

## Verification

Build the CLI dependency closure before running the tests:

```bash
pnpm --filter @aidha/praecis-cli... build
pnpm --filter @aidha/praecis-cli exec vitest run tests/startup-import-boundary.test.ts
pnpm --filter @aidha/praecis-cli exec vitest run
pnpm --filter @aidha/praecis-cli lint
node scripts/meminit-check.mjs docs/55-testing/testing-091-cli-startup-import-boundary.md
pnpm docs:build
```

The commands describe the intended checks; review evidence records actual results and any
environment limitations.
