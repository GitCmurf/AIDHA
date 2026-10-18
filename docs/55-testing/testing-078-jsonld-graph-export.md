---
document_id: AIDHA-TESTING-078
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Read-Only JSON-LD Graph Export
type: TESTING
docops_version: '2.0'
area: CLI
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-078
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Read-Only JSON-LD Graph Export

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify full graph export without database initialization or output replacement. | — | Draft | Original commit 2775413 |

## Scope and contract

Expose the existing graph-backend JSON-LD serializer through the production command
`aidha export graph --jsonld [--out <new-file>] [--config <path>] [--profile <name>]`.
Extract this command independently of activation and continuity. Export the full graph,
including operational nodes, using the existing serializer's metadata and relationship rules.
The graph API skips invalid node records and dangling edges; this is an interoperability export,
not a forensic database backup.

The command resolves configuration without creating ingestion services. A missing explicitly
selected configuration must fail rather than silently select a default database. The database
must already exist with readable graph tables. No schema initialization, migration, FTS repair,
directory creation for a missing database, writable fallback or model request is permitted.

Acquire one coherent SQLite read transaction across the node and edge queries. The connection
must open read-only and close on success or failure. Refuse runtimes that do not support the
read-only constructor option before opening any database. Keep the repository-wide Node floor
unchanged; document this command's narrower runtime requirement.

Without `--out`, stdout contains exactly one JSON-LD document and a newline. With `--out`,
serialize first, then create the destination exclusively; refuse existing files, directories,
symlinks and hardlinks. Protect database paths and SQLite sidecar names, including aliases
through an existing symlinked parent directory. Reserve case variants in the same physical
directory on every filesystem; allow the same basename in a different directory.
Do not add overwrite or force behavior.
Do not create missing output directories. Remove only a new partial output owned by this
operation if writing it fails. Diagnostics use stderr and failures exit nonzero.

## Acceptance criteria and regressions

- The built public executable exports known nodes, metadata, schema version and relationship
  URIs, including a seeded operational Task, from the selected profile. Repeated output is
  deterministic and file output agrees with stdout.
- After every tested success or failure, graph and configuration bytes remain unchanged.
  A fresh graph lifecycle also preserves the complete logical snapshot. Missing optional
  FTS structures are not created or repaired during export.
- Missing/corrupt graphs, missing explicit config, unsupported modes/options, missing option
  values and unsupported runtimes fail without output files or graph creation.
- Existing output, database/config collisions, symlink/hardlink aliases and reserved SQLite
  sidecars cannot be overwritten. A failed write does not remove an existing destination.
- A concurrent independent writer cannot produce a mixed node/edge snapshot.
- Existing writable store and ingestion behavior remain protected by their owning suites.

The production executable acceptance is in
`packages/praecis/cli/tests/graph-export.test.ts`. Backend read-only connection, transaction,
failure and preservation contracts are in `packages/reconditum/tests/sqlite-read-snapshot.test.ts`.
Use fictional temporary graphs and isolated configuration only. Run owning package tests,
build/lint, strict changed-test TypeScript, scoped DocOps and `pnpm docs:build`. Obtain material
code review before commit. No live model, private graph or paid service is needed.
