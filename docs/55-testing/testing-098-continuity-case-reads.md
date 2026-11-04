---
document_id: AIDHA-TESTING-098
owner: Engineering
status: Draft
version: '0.11'
last_updated: 2026-11-04
title: Bounded Read-Only Continuity Case Retrieval
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PRD-004, AIDHA-ADR-010, AIDHA-TESTING-088]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-098
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.11
> **Last Updated:** 2026-11-04
> **Type:** TESTING

# Bounded Read-Only Continuity Case Retrieval

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-03 | Codex | Specify single-case reads that avoid unrelated graph data and retain observational behaviour. | — | Draft | AIDHA-TESTING-088 |
| 0.2 | 2026-11-03 | Codex | Pin new API acceptance coverage to its reviewed source commit. | — | Draft | 1e119d2 |
| 0.3 | 2026-11-03 | Codex | Simplify reviewed promise wrappers and separate runtime compatibility from read lifecycle control. | — | Draft | PR 66 |
| 0.4 | 2026-11-03 | Codex | Share error normalisation and qualify non-Error diagnostics, Error identity and cleanup precedence. | — | Draft | PR 66 |
| 0.5 | 2026-11-03 | Codex | Preserve detached static-reader calls with public API regressions. | — | Draft | PR 66 |
| 0.6 | 2026-11-03 | Codex | Pin CLI, node and snapshot acceptance links to the reviewed regression source. | — | Draft | 4e5cc24 |
| 0.7 | 2026-11-03 | Codex | Separate rollback and close attempts while retaining diagnostic precedence and connection cleanup. | — | Draft | PR 66 |
| 0.8 | 2026-11-03 | Codex | Pin rollback cleanup coverage to its reviewed implementation. | — | Draft | 87b112c |
| 0.9 | 2026-11-03 | Codex | Parse Node version parts explicitly and protect existing support boundaries through the public reader. | — | Draft | PR 66 |
| 0.10 | 2026-11-03 | Codex | Pin the public runtime-boundary matrix to its reviewed source. | — | Draft | 405a03c |
| 0.11 | 2026-11-04 | Codex | Integrate reviewed main dependencies without changing feature source or tests and record the fresh bounded qualification. | — | Draft | Main a6b043b; PR 66 |

## Purpose

Reading one saved continuity case should require only its own Resource record. Exporting the full
graph first makes each read depend on unrelated nodes and edges as the archive grows. This slice
preserves the capture, correction and display contracts in
[AIDHA-PRD-004](../10-prd/prd-004-continuity-capture.md); it changes only acquisition of a case for
`continuity show`.

## Graph API

`SQLiteStore.readNode(path, id)` reads one node by its exact primary key and returns the existing
`Result<GraphNode | null>` contract. A missing node returns a successful null result; an unreadable
database, incomplete node schema or invalid selected node returns an error. The ID is a bound SQL
parameter. The method opens an existing database read-only, performs no initialization, migration
or index repair, and closes the connection on success and failure. It shares the read-only
connection lifecycle with `SQLiteStore.readSnapshot`.
Both static readers remain callable through detached function references; database failures still
return an error Result rather than throwing because a class receiver is absent.

The existing Node requirements for read-only SQLite access apply: Node 22.12 or later on the 22.x
line, Node 23.2 or later on the 23.x line, or Node 24 and later. Unsupported versions fail before
opening a database.

## Acceptance

- The [public CLI tests][cli-tests] create a synthetic case,
  add 2,000 unrelated records and remove the unrelated edges table. `show` still returns the exact
  same case; an absent case reports its own unknown-case diagnostic. Database bytes and directory
  entries remain unchanged after these reads. This is a dependency-boundary check, not a latency
  benchmark.
- Existing CLI controls continue to prove that `show` never creates a missing database, preserves
  bytes and directory contents on an ordinary graph, honours explicit configuration, and retains
  JSON and Markdown output.
- The [single-node API tests][node-tests] cover exact
  key selection, detached static-reader calls, missing nodes and databases, selected-node validation,
  unsupported runtimes and
  reads without graph edges, views or search structures. They compare persisted bytes and verify
  connection cleanup on error.
  A matrix of simulated Node version reports checks support boundaries and missing minor versions,
  distinguishing runtime rejection from read-only acquisition errors at an intentionally missing
  database path. The selected parent and database remain absent.
- Existing [snapshot lifecycle tests][snapshot-tests]
  continue to cover coherent concurrent reads, rejection of writes through the wrapped store,
  missing schema, acquisition failures and cleanup error precedence for the shared lifecycle.
  Non-Error read and close failures become Error diagnostics, while existing Error objects retain
  their identity. A later cleanup failure cannot replace a primary read failure.
  A failed rollback still precedes one close attempt and preserves the exact primary read Error.

## Validation commands

From the repository root:

```bash
pnpm --filter @aidha/praecis-cli... build
pnpm --filter @aidha/graph-backend exec vitest run tests/sqlite-read-node.test.ts tests/sqlite-read-snapshot.test.ts
pnpm --filter @aidha/praecis-cli exec vitest run tests/continuity.test.ts tests/graph-export.test.ts
pnpm --filter @aidha/graph-backend lint
pnpm --filter @aidha/praecis-cli lint
node scripts/meminit-check.mjs docs/55-testing/testing-088-continuity-capture.md docs/55-testing/testing-098-continuity-case-reads.md
pnpm docs:build
```

These commands define the checks, not their results. No live personal store, background service,
provider call, new default or task-management integration is part of this change.

## Upstream integration qualification — 2026-11-04

Integrate immutable main `a6b043b51db6fc74873c976765bd49ea0194ea20`, tree
`770020da9904f3428af0f9942dc9663fb030c690`, into reviewed continuity head
`74abbb525e1cba395e31c20c3df5989482c2a9e3`. All six continuity source and test
files, plus [AIDHA-TESTING-088](testing-088-continuity-capture.md), retain their
reviewed bytes. The test-source links below remain pinned to the same commits.
The PR's own delta against this main remains nine paths.

Frozen strict-peer installation accepts the upstream graph without dependency
resolution. The entire lockfile matches main byte for byte. Installed artifact
reads confirm the reviewed dependency maintenance:

| Installed artifacts | Versions |
| --- | --- |
| Vitest and its seven regular `@vitest/*` siblings | 4.1.12 throughout |
| Vite, PostCSS, source-map-js | 8.1.6, 8.5.28, 1.2.2 |
| fast-uri | 3.1.9 |
| mailparser, Nodemailer, `@zone-eu/mailsplit` | 3.9.43, 10.1.4, 5.4.25 |

The published parent contracts and earlier consumer checks are recorded in
[AIDHA-TESTING-101](testing-101-fast-uri-maintenance.md),
[AIDHA-TESTING-102](testing-102-mailparser-address-identity.md) and
[AIDHA-TESTING-103](testing-103-vitest-maintenance.md).

Fresh checks on Node 24.22.2 and Vitest 4.1.12 pass: backend build and lint, strict
TypeScript compilation of both read-only test files, 12 selected read-only controls
and four unchanged email identity cases. The 12 controls comprise nine simulated
version boundaries, two detached calls and one failed-rollback cleanup case.
The name filter leaves 24 other read-only cases unexecuted; no test body, skip or
timeout setting changes. These version simulations do not establish execution on
older Node runtimes. Archive-scale fixtures, full snapshot lifecycle suites and
YouTube or workspace-wide suites are not repeated locally in this integration.

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --filter @aidha/graph-backend --fail-if-no-match build
pnpm --filter @aidha/graph-backend --fail-if-no-match lint
pnpm --filter @aidha/graph-backend --fail-if-no-match exec tsc --ignoreConfig --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --esModuleInterop --skipLibCheck --noUncheckedIndexedAccess tests/sqlite-read-node.test.ts tests/sqlite-read-snapshot.test.ts
pnpm --filter @aidha/graph-backend --fail-if-no-match exec vitest run tests/sqlite-read-node.test.ts tests/sqlite-read-snapshot.test.ts --testNamePattern 'preserves SQLite read-only version boundaries|returns a Result from detached|preserves the primary read failure and closes once after rollback fails' --maxWorkers=1 --no-file-parallelism
pnpm --filter @aidha/praecis-source-email --fail-if-no-match exec vitest run tests/address-identity.test.ts --maxWorkers=1 --no-file-parallelism
node scripts/meminit-check.mjs docs/55-testing/testing-088-continuity-capture.md docs/55-testing/testing-098-continuity-case-reads.md
pnpm docs:build
```

At 00:45 UTC on 2026-11-04, fresh GitHub metadata for exact main `a6b043b` showed
successful [TypeScript verification][main-typescript], [documentation build][main-docs],
[secret scan][main-secrets] and all three [CodeQL analyses][main-codeql]. Its four
[DeepSource statuses][main-statuses] were also successful. This records the
upstream baseline. PR 66 still requires fresh full default CI and every reporting
analyser and review bot to be green on its own integrated head before merge.

[cli-tests]: https://github.com/GitCmurf/AIDHA/blob/4e5cc244ca1d3e63ebf16cee9d1d49fb76c23582/packages/praecis/cli/tests/continuity.test.ts
[node-tests]: https://github.com/GitCmurf/AIDHA/blob/405a03cc6b222394161a645d1c5d307cc5fbc88b/packages/reconditum/tests/sqlite-read-node.test.ts
[snapshot-tests]: https://github.com/GitCmurf/AIDHA/blob/87b112ca97af06cccddc44bdce794627ee43ccb2/packages/reconditum/tests/sqlite-read-snapshot.test.ts
[main-typescript]: https://github.com/GitCmurf/AIDHA/actions/runs/41748019987/job/126305804335
[main-docs]: https://github.com/GitCmurf/AIDHA/actions/runs/41748020068/job/126305804716
[main-secrets]: https://github.com/GitCmurf/AIDHA/actions/runs/41748019950/job/126305803978
[main-codeql]: https://github.com/GitCmurf/AIDHA/actions/runs/41748020539
[main-statuses]: https://api.github.com/repos/GitCmurf/AIDHA/commits/a6b043b51db6fc74873c976765bd49ea0194ea20/status
