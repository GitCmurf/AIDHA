---
document_id: AIDHA-RUNBOOK-014
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-18
title: Personal Continuity Capture and Recovery
type: RUNBOOK
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PRD-004, AIDHA-ADR-010, AIDHA-TESTING-088]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-014
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-18
> **Type:** RUNBOOK

# Personal Continuity Capture and Recovery

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-09-11 | Codex | Document the first capture, correction and recovery commands. | — | Draft | — |
| 0.2 | 2026-10-18 | Codex | Align steps with the workspace CLI entry point and bound scope to capture, show and direct correction. | — | Draft | AIDHA-PRD-004 |

## Purpose and safety

Use this runbook to capture a structured account, inspect the saved case, and correct one named fact
while retaining the original and correction sources. The input is user-provided JSON; no model is
invoked. Saving a record does not authorize an action, create a task, schedule work, or notify
anyone.

Use fictional fixture data for public tests. Keep real accounts, source files, database files,
outputs, and local paths outside the repository and public acceptance artifacts. See
[AIDHA-ADR-010](../20-adr/adr-010-continuity-case-events.md) for the persistence boundary and
[AIDHA-TESTING-088](../55-testing/testing-088-continuity-capture.md) for deterministic checks.

## Prerequisites

Use Node.js 22.12 or later with the repository's pnpm toolchain for this feature. The workspace
currently declares Node.js `>=22.5.0`; that package-engine declaration is not evidence that every
runtime version was exercised for this feature and remains unchanged by this runbook. Record the
exact runtime used in the feature verification evidence. Build the actual CLI and its dependency
closure:

```bash
pnpm --filter @aidha/praecis-cli... build
```

Invoke the built package entry point. Do not assume a root `scripts/aidha` launcher exists. The help
and schema commands are store-free; use the generated JSON Schema as the input contract for each
event:

```bash
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity --help
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity schema --kind capture
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity schema --kind update
```

Supply an explicit configuration that selects a local SQLite database. Protect the configuration,
source inputs, and database as private data. The database is authoritative for the captured event
history; a generated report or copied summary is not. For storage commands, `--config <path>` takes
precedence over `AIDHA_CONFIG`; a valid config uses its `default_profile` when `--profile` is
omitted. A missing explicitly selected CLI or environment config fails closed instead of falling
back to a default database. A bare `--config` or `--profile` is an error. Schema and help inspection
do not open a database.

## Capture, inspect, correct, inspect

Prepare a schema-valid capture JSON file with a stable case ID, stable source and event IDs, the
original source account, capture intent/time, interpreter provenance, activities, facts, and any
supported decisions or questions. Distinguish facts explicitly supplied by the source from
inferences. If an activity date is unknown, represent it as unknown; do not turn it into a recurring
or all-dates claim. Record responsibility as an explicit fact only when supplied.

After the build, use the CLI's `continuity capture`, `continuity show`, and `continuity update`
commands with the same case ID and explicit `--config` path. Capture input has `kind: "capture"` and
expected revision zero. A correction input has `kind: "correct"`, a new event/source identity, an
expected current revision, a target `factId`, corrected value, and supplied/inferred basis. The
schemas command above prints the complete strict field definitions. The intended sequence is:

```text
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity capture --case CASE_ID --input capture.json --config case-config.yaml
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity show --case CASE_ID --on YYYY-MM-DD --config case-config.yaml --json
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity update --case CASE_ID --input correction.json --config case-config.yaml
node --experimental-sqlite packages/praecis/cli/dist/cli.js continuity show --case CASE_ID --on YYYY-MM-DD --config case-config.yaml --json
```

Each command is a separate process and must resolve the same configured store. `--on` selects the
date for the read projection; it does not reschedule activities or mark them complete. Inspect the
final view and event history: the correction should identify its source and event, replace only the
named fact in the current projection, and leave the original event/source and unrelated records
intact. Human-readable output escapes source-derived markup; JSON output retains exact text.

The JSON input limit is 1 MiB. Oversized input must be rejected before parsing or writing. A
correction must carry a new event/source identity and the revision it was based on. Exact event
replay is safe and idempotent. If the event ID exists with different content or the expected
revision is stale, stop, inspect current state, and prepare a newly assessed correction. After an
uncertain command outcome, inspect the saved history before retrying. Never bypass a conflict by
silently changing an event ID.

## Recovery limits

Writes require transaction support; a nontransactional store must reject mutation. Failed validation
or a failed transaction must leave the previous case intact. This runbook covers local capture,
readback, and direct fact correction only. It does not read or alter PEPYS, create or update
commitments, execute actions, or cover routine schedules, briefings, refresh/checkpoints, proposals,
forgetting, or background automation.

## Verification

The deterministic acceptance contract is in
[AIDHA-TESTING-088](../55-testing/testing-088-continuity-capture.md). This runbook does not claim a
live personal-data rehearsal or establish semantic accuracy of an interpretation.
