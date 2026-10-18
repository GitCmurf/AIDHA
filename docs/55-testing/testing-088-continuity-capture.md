---
document_id: AIDHA-TESTING-088
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Continuity Capture and Direct-Correction Acceptance
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PRD-004, AIDHA-ADR-010, AIDHA-RUNBOOK-014, AIDHA-PLAN-015]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-088
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Continuity Capture and Direct-Correction Acceptance

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify core and public-process acceptance for bounded capture, readback and direct correction. | — | Draft | AIDHA-PLAN-015 |

## Scope and limit

This specification covers the capture → show → direct fact correction → show contract from
[AIDHA-PRD-004](../10-prd/prd-004-continuity-capture.md). Tests use synthetic fixtures and local
stores. Structural and persistence checks do not prove semantic accuracy, completeness of a human
interpretation, or identity/authenticity of a named source or interpreter.

## Core acceptance

The focused core suite is `packages/praecis/core/tests/continuity/case.test.ts` with fixture data
under `packages/praecis/core/tests/continuity/fixture.ts`. Its acceptance cases verify:

- Strict input schemas and validation reject unknown fields, duplicate record IDs, dangling
  prerequisite/fact/decision/question activity references, prerequisite cycles, conflicting facts
  for one activity/key, date-basis and fact-date contradictions before mutation, leaving the graph
  empty on capture rejection.
- A correction rejects source-ID collisions, changed case intent, and unknown target facts without
  changing the saved graph. A Resource aggregate copied to another case ID and a non-Resource node
  at a continuity ID are rejected without modifying either record.
- Unknown activity dates remain explicitly unknown; a fact's applicability matches its activity,
  including null. Supplied and inferred fact bases remain distinguishable. Responsibility is
  retained only when explicit; participants alone do not produce ownership.
- Source account text, source IDs, event history, and interpreter provenance survive projection. A
  correction changes only its named fact and keeps both original and correction provenance.
- Replaying the same event with identical content is idempotent. Reusing an event ID with changed
  content and writing from a stale expected revision fail.
- A store without transaction support refuses mutation. An injected `upsertNode` write failure after
  the write has been attempted rolls back the case. Concurrent SQLite writes based on the same
  revision produce one winner. This contract test does not inject a failure at the underlying SQLite
  commit boundary.
- Human-readable rendering escapes HTML, control characters, and Markdown metacharacters while
  structured JSON preserves source text.

## Public CLI acceptance

The public-process suite is `packages/praecis/cli/tests/continuity.test.ts`. It builds and launches
the actual CLI package entry point, `packages/praecis/cli/dist/cli.js`, with an explicit config and
isolated SQLite database. Its cases verify that generated capture/update schemas and help do not
open a database; exactly 1 MiB is accepted while oversized or non-file input is rejected before
opening the selected store; an absent explicitly selected config fails closed; a valid config uses
its default profile; `AIDHA_CONFIG` resolution and CLI-over-environment precedence behave as
documented; and missing config/profile values are rejected. It then runs capture, show, direct
correction, and final show in separate processes, asserting exact source/history recovery, preserved
unrelated decisions/questions/facts, idempotent replay, stale-revision rejection, and unchanged
state after a failed update. Do not substitute a saved-tree-only wrapper or in-process helper for
this process boundary.

The public-process acceptance also covers exact event replay, stale revision rejection, and
concurrent same-revision corrections where the fixture can exercise them deterministically. `show`
requires an explicit `--on` date for its projection; this is read-time selection and does not change
activity state.

Input reading must reject JSON larger than 1 MiB while reading the same opened file handle, before
parse or write. A check that only stats a path before a later unbounded read does not meet this
contract.

## Commands

From the repository root, build the dependency closure and actual CLI before its process tests:

```bash
pnpm --filter @aidha/praecis-cli... build
pnpm --filter @aidha/praecis-core exec vitest run tests/continuity/case.test.ts
pnpm --filter @aidha/praecis-cli exec vitest run tests/continuity.test.ts
pnpm --filter @aidha/praecis-core lint
pnpm --filter @aidha/praecis-cli lint
node scripts/meminit-check.mjs docs/10-prd/prd-004-continuity-capture.md docs/20-adr/adr-010-continuity-case-events.md docs/50-runbooks/runbook-014-personal-continuity.md docs/55-testing/testing-088-continuity-capture.md
pnpm docs:build
```

Commands above define the validation procedure; this document does not record their execution or
result. Record actual output, exit status, runtime version, and any skipped/unavailable checks in
the review or CI evidence for the change.

## Explicitly not tested here

No model/provider call, live personal source, semantic interpretation score, PEPYS access/change,
task lifecycle, routine schedule, briefing, background refresh, proposal workflow, or real-world
action is in scope. Passing these tests is not evidence for those capabilities.
