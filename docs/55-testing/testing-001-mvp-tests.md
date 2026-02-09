---
document_id: AIDHA-TESTING-001
owner: Engineering
status: Draft
version: '0.12'
last_updated: 2026-02-08
title: MVP Test Suite Map and Hardening Coverage
type: TESTING
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-001
> **Owner:** Engineering
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.12
> **Last Updated:** 2026-02-08
> **Type:** TESTING

# MVP Test Suite Map and Hardening Coverage

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1     | 2026-02-07 | AI     | Initial MVP test-suite map and hardening summary | — | Draft | — |
| 0.2     | 2026-02-07 | AI     | Add area/goal test coverage and refresh baseline | — | Draft | — |
| 0.3     | 2026-02-07 | AI     | Refresh passing baseline and note remaining coverage gaps | — | Draft | — |
| 0.4     | 2026-02-07 | AI     | Add project helper coverage and refresh outstanding gaps | — | Draft | — |
| 0.5     | 2026-02-07 | AI     | Refresh full-suite baseline after project helper tests | — | Draft | — |
| 0.6     | 2026-02-07 | AI     | Refresh full-suite baseline after slug hardening test | — | Draft | — |
| 0.7     | 2026-02-07 | AI     | Add split dossier/transcript export coverage and refresh baseline | — | Draft | — |
| 0.8     | 2026-02-07 | AI     | Add yt-dlp runtime + diagnose coverage and refresh baseline | — | Draft | — |
| 0.9     | 2026-02-08 | AI     | Add editorial ranking modules/tests and diagnose editor coverage | — | Draft | — |
| 0.10    | 2026-02-08 | AI     | Add editor rewrite guardrail coverage and refresh baseline | — | Draft | — |
| 0.11    | 2026-02-08 | AI     | Add preflight and subcommand help routing coverage | — | Draft | — |
| 0.12    | 2026-02-08 | AI     | Add offline YouTube golden fixture invariant coverage | — | Draft | — |

## Purpose

Provide a single reference for the current MVP test suite, with emphasis on hardening coverage
used to protect refactors in graph storage, ingestion, extraction, and review workflows.

## Package-Level Test Map

### `packages/reconditum`

- `tests/store.test.ts`: core CRUD and query behavior for the in-memory backend.
- `tests/contract/store.contract.test.ts`: parity contract checks between in-memory and SQLite
  backends.
- `tests/sqlite-fts.test.ts`: SQLite FTS indexing and lookup behavior.
- `tests/export.test.ts`: JSON-LD export contract.
- `tests/schema.test.ts`: schema guards and validation invariants.
- `tests/transaction.contract.test.ts`: transaction rollback, nesting, serialization, and stress
  behavior for in-memory and SQLite backends.

### `packages/praecis/youtube`

- `tests/pipeline.test.ts`: ingestion flow coverage.
- `tests/extraction.test.ts`: claim/reference extraction invariants and metadata handling.
- `tests/llm-claims.test.ts`: two-pass extraction, cache invalidation, rewrite-cache behavior,
  and rewrite guardrails (numeric preservation, keyword overlap, edit ratio).
- `tests/editorial-ranking.v1.test.ts`: v1 editorial characterization and deterministic ordering.
- `tests/editorial-ranking.v2.test.ts`: v2 scoring/diversity behavior and diagnostics invariants.
- `tests/editorial-metrics.test.ts`: deterministic fragment/boilerplate/coverage helper checks.
- `tests/review.test.ts`: review queue and review-apply behavior, including rollback and
  concurrency metadata preservation.
- `tests/review-atomicity.sqlite.test.ts`: SQLite-backed review batch atomicity checks.
- `tests/cli-review-atomicity.test.ts`: process-level CLI atomicity checks with DB snapshot
  comparison.
- `tests/cli-export.test.ts`: CLI split dossier and transcript JSON export coverage.
- `tests/cli-preflight.test.ts`: preflight command output and `--help` subcommand routing.
- `tests/golden-fixtures.test.ts`: offline golden fixture invariants and determinism checks.
- `tests/yt-dlp.test.ts`: yt-dlp runtime argument wiring and subtitle fallback behavior.
- `tests/planning.test.ts`, `tests/cli-area-goal.test.ts`: area/goal/project helper behavior and
  CLI command coverage.
- `tests/retrieval.test.ts`, `tests/related.test.ts`: query and related-claim ranking behavior.
- `tests/dossier.test.ts`: markdown dossier export checks.
- `tests/diagnose.test.ts`: transcript, extraction, and cache-based editor diagnostics behavior.
- `tests/help-text.test.ts`: CLI self-documentation guardrails for query state flags.
- `tests/claims-coverage.test.ts`: extraction timeline and count-range coverage.
- `tests/client.test.ts`, `tests/yt-dlp.test.ts`, `tests/transcript-parse.test.ts`,
  `tests/status.test.ts`, `tests/status-format.test.ts`, `tests/urls.test.ts`,
  `tests/schema.test.ts`,
  `tests/task.test.ts`, `tests/cli.test.ts`: unit and integration support coverage.
- `tests/real-client.test.ts`: external-network client tests (intentionally skipped in normal CI).

## Hardening Coverage Focus

### Atomicity and Rollback

- Batch review updates are tested to ensure no partial writes when any claim in a batch fails.
- Transaction contracts verify rollback behavior for explicit failures and thrown errors.
- Nested transaction tests verify both fail and success paths.
- CLI-level atomicity tests verify command exit codes and unchanged full snapshots on failed
  batches.

### Concurrency and Lost-Update Guardrails

- Concurrent top-level transaction serialization is tested across store backends.
- Randomized transaction stress tests verify that only successful transactional writes persist.
- Review and extraction tests validate that concurrent metadata writes are preserved.

### Refactor Safety

- Cross-backend parity tests in `reconditum` ensure future backend changes keep behavior aligned.
- Contract and integration tests assert deterministic ordering and idempotent upserts.
- Help-text tests prevent CLI flag drift from implementation behavior.

## How to Run the Suite

### Full package runs

```bash
pnpm -C packages/reconditum test
pnpm -C packages/reconditum build
pnpm -C packages/praecis/youtube test
pnpm -C packages/praecis/youtube build
```

### High-value targeted runs

```bash
pnpm -C packages/reconditum test -- transaction.contract.test.ts
pnpm -C packages/praecis/youtube test -- review.test.ts
pnpm -C packages/praecis/youtube test -- review-atomicity.sqlite.test.ts
pnpm -C packages/praecis/youtube test -- cli-review-atomicity.test.ts
pnpm -C packages/praecis/youtube test -- extraction.test.ts
```

## Current Baseline (2026-02-08)

- `@aidha/graph-backend`: 62 tests passing.
- `@aidha/ingestion-youtube`: 115 tests passing, 6 tests skipped (`real-client` network-dependent).

## Remaining Coverage Gaps

- No known critical coverage gaps for implemented MVP + strengthening milestone features.

Keep this section current when adding, removing, or reclassifying test groups.
