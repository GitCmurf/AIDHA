---
document_id: AIDHA-GUIDE-001
owner: Graph Backend Team
status: Draft
last_updated: 2026-10-18
version: '0.4'
title: Graph Backend Quickstart
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-001
> **Owner:** Graph Backend Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-10-18
> **Type:** GUIDE

## Version History

| Version | Date       | Author | Change Summary                            | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ----------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Seed placeholder quickstart               | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Adopt DocOps 2.0 ID + add Version History | —         | Draft  | —         |
| 0.3 | 2026-10-18 | Codex | Document read-only JSON-LD graph export. | — | Draft | AIDHA-TESTING-078 |
| 0.4 | 2026-10-18 | Codex | Describe atomic export publication. | — | Draft | AIDHA-TESTING-078 |

## Purpose

Build the graph backend and export an existing graph as JSON-LD using the shared AIDHA CLI.
Run the commands below from the repository root.

## Build

```bash
pnpm install
pnpm build
```

The read-only snapshot API requires Node 22.12 or later on the 22.x line, Node 23.2 or later
on the 23.x line, or Node 24 and later. See the [Node 22 API][node22] and [Node 23 API][node23].
Older supported project runtimes can still use the
existing backend but cannot use this export command. Among the export-supported versions,
early releases that gate `node:sqlite` also need their documented `--experimental-sqlite` flag.
The flag does not enable export on versions below the requirements above.
The command refuses unsupported runtimes before opening a database.

## Export an existing graph

Use an existing configuration and a graph already created by ingestion or the graph API.
See [AIDHA-GUIDE-003](ingest-quickstart.md) for ingestion and
[AIDHA-GUIDE-005](config-guide.md) for configuration. An example profile points to a database
relative to the configuration file:

```yaml
config_version: 1
default_profile: local
profiles:
  local:
    db: ./out/aidha.sqlite
```

Print JSON-LD to stdout:

```bash
node packages/praecis/cli/dist/cli.js export graph --jsonld --config ./config.yaml
```

Or create a new output file:

```bash
node packages/praecis/cli/dist/cli.js export graph --jsonld \
  --config ./config.yaml --profile local --out ./graph-export.jsonld
```

The export includes the full graph, including operational nodes such as Tasks. It uses the
existing JSON-LD context, node metadata filtering and relationship URIs. Repeated exports of
the same graph are deterministic. No API key or model call is needed.

The database must exist. Export reads one coherent snapshot without initializing schema,
migrating tables or repairing search indexes. A missing explicitly selected config fails
rather than selecting another database. Existing output files and links are refused, as are
database and SQLite sidecar destinations, including case variants in the same physical
directory. Missing output directories are not created. Output is written completely in a
private sibling staging directory before atomic hard-link publication; existing or concurrently
published destinations are never replaced or removed by cleanup. Filesystems without this
publication capability fail without exposing partial output. If private staging cleanup fails
after publication, the command reports failure and leaves the complete output in place.
With `--out`, stdout stays empty; errors go to stderr and exit nonzero.

## Verify

```bash
pnpm --filter @aidha/graph-backend test:ci
pnpm --filter @aidha/praecis-cli test:ci
```

[AIDHA-TESTING-078](../55-testing/testing-078-jsonld-graph-export.md) specifies the executable,
reopened-graph, input-file preservation and concurrent-writer regressions. JSON-LD export
follows the existing graph API's filtering of invalid nodes and dangling edges.

[node22]: https://nodejs.org/download/release/v22.12.0/docs/api/sqlite.html
[node23]: https://nodejs.org/download/release/v23.2.0/docs/api/sqlite.html
