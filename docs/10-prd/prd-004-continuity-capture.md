---
document_id: AIDHA-PRD-004
owner: Product
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Bounded Continuity Capture and Correction
type: PRD
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-ADR-010, AIDHA-RUNBOOK-014, AIDHA-TESTING-088, AIDHA-PLAN-015]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PRD-004
> **Owner:** Product
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** PRD

# Bounded Continuity Capture and Correction

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify the bounded capture, readback and direct-correction contract. | — | Draft | AIDHA-PLAN-015 |

## Purpose and scope

This PRD specifies a local, inspectable record for capturing a user-supplied account, reading it
back, and correcting one named fact while preserving its history. The user supplies structured JSON
to the CLI. Each invocation can run in a separate process against the same explicitly configured
SQLite database.

The public workflow is `capture → show → update (direct fact correction) → show`. It is a
data-recording tool. It does not decide what the user should do, create tasks, schedule actions,
notify people, or interpret prose with a model. No model is needed for validated JSON input.

## Data and provenance requirements

- Preserve the source account and its source identity, capture intent, capture time, and interpreter
  provenance as submitted. Source text is data; never execute it.
- Retain the append-only event history and source records when projecting current state. A
  correction adds its own source/event and updates only its target fact; unrelated facts, decisions,
  activities, and questions remain intact.
- Keep supplied and inferred fact bases distinguishable. A participant list is not evidence of
  responsibility: responsibility or ownership must be represented as an explicit supplied fact.
- Represent an unknown activity date explicitly with `dateBasis: unknown`. A null date means
  unknown, not “applies on every date.” Fact applicability follows its referenced activity,
  including an unknown date.
- Validate schemas and references before writes. Reject duplicate identifiers, dangling activity
  references, prerequisite cycles, conflicting facts for one activity, invalid decision/question
  activity references, stale revisions, and event-ID reuse with changed content.
- An exact replay of an already accepted event is idempotent. A write requires a transactional
  store. A failed write leaves the prior case state intact; concurrent updates from the same
  revision cannot both win.
- Bound JSON input to 1 MiB using a read that enforces the limit while consuming the opened file. A
  prior `stat` check alone is insufficient.

## User-visible behavior

`capture` creates a case at its initial revision from validated input. `show` is observational and
can return structured JSON or human-readable output; it exposes current facts together with their
source attribution and event history. Human-readable output must escape source-derived HTML, control
characters, and Markdown syntax. JSON output preserves source/event text.

`update` supports a direct correction to one existing fact, with a new source and event identity and
the expected current revision. It is not a proposal/review workflow. A stale revision or
changed-content event collision is an error; callers must inspect current state and reassess rather
than silently retry with a new ID.

## Explicit exclusions

This scope excludes routine schedules, dated exceptions, briefings, background refresh/checkpoints,
project-change proposals, forgetting/tombstones, PEPYS reads or snapshots, goal progress, Task
creation, autonomous interpretation, model selection, and date-comparison policy. PEPYS remains the
separate authority for commitments; this workflow neither reads nor changes it. No inference or
fixture test proves that an interpretation is semantically accurate or authenticates the named
author/interpreter.

## Acceptance boundary

Acceptance is defined in [AIDHA-TESTING-088](../55-testing/testing-088-continuity-capture.md). The
governing persistence decision is [AIDHA-ADR-010](../20-adr/adr-010-continuity-case-events.md);
operator steps are in [AIDHA-RUNBOOK-014](../50-runbooks/runbook-014-personal-continuity.md). These
documents specify intended behavior; their presence does not itself report test completion or a
live-user rehearsal.
