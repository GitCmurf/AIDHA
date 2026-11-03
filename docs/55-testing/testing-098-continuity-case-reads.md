---
document_id: AIDHA-TESTING-098
owner: Engineering
status: Draft
version: '0.9'
last_updated: 2026-11-03
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
> **Version:** 0.9
> **Last Updated:** 2026-11-03
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

[cli-tests]: https://github.com/GitCmurf/AIDHA/blob/4e5cc244ca1d3e63ebf16cee9d1d49fb76c23582/packages/praecis/cli/tests/continuity.test.ts
[node-tests]: https://github.com/GitCmurf/AIDHA/blob/4e5cc244ca1d3e63ebf16cee9d1d49fb76c23582/packages/reconditum/tests/sqlite-read-node.test.ts
[snapshot-tests]: https://github.com/GitCmurf/AIDHA/blob/87b112ca97af06cccddc44bdce794627ee43ccb2/packages/reconditum/tests/sqlite-read-snapshot.test.ts
