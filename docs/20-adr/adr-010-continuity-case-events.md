---
document_id: AIDHA-ADR-010
owner: Engineering
status: Draft
version: '1.2'
last_updated: 2026-10-18
title: Persist Continuity as Bounded Case Events
type: ADR
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PRD-004, AIDHA-RUNBOOK-014, AIDHA-TESTING-088]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-010
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 1.2
> **Last Updated:** 2026-10-18
> **Type:** ADR

# Persist Continuity as Bounded Case Events

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 1.0 | 2026-09-11 | Codex | Define the transactional case boundary and separate evidence from commitments. | — | Draft | — |
| 1.1 | 2026-09-11 | Codex | Allocate unique ADR-010 after scoped registry validation. | — | Draft | — |
| 1.2 | 2026-10-18 | Codex | Reconcile the decision with the bounded capture/correction extraction; remove references to absent planning material and out-of-scope features. | — | Draft | AIDHA-PRD-004 |

## Context

A current-value-only record loses correction provenance. Conversely, treating a capture as a task or
commitment would create a competing authority. The graph backend provides transactions, while the
CLI has configuration and SQLite store primitives. This decision supports the bounded behavior in
[AIDHA-PRD-004](../10-prd/prd-004-continuity-capture.md).

## Decision

Store one bounded case as one namespaced Resource node whose versioned `metadata.continuity` value
contains validated events. The continuity module owns the schema and projects current state from the
event log. A fact belongs to an activity; a direct correction identifies one existing fact. This
does not add a general graph ontology or a separate event bus.

A mutation identifies its event, expected case revision, source account, and interpreter provenance.
Within a GraphStore transaction, read the case, check replay identity and revision, validate
references, then append the event. Replaying identical event content is a no-op. Reusing an event ID
for different content or writing against a stale revision fails without changing the case. A store
without transaction support cannot perform mutations. SQLite uses its existing
transaction/serialization behavior; lock or operation failure is surfaced and is not retried as an
unknown outcome.

Capture retains the submitted source and distinguishes supplied facts from inferred facts. Unknown
dates remain explicitly unknown and do not imply applicability on every date. Responsibility is
recorded only when explicit in the input; participant membership does not establish ownership.
Direct correction preserves the original and correction sources and all prior events while changing
only the projected target fact.

The CLI accepts validated structured input. This deterministic boundary validates structure and
persistence only; it cannot prove that an account or interpretation is semantically accurate, nor
authenticate the person named as its author or interpreter. Source content is data, never executable
input. PEPYS remains the separate commitment authority and is not read or changed by this scope.

## Consequences

The case aggregate makes restart recovery and correction history inspectable, at the cost of
limiting this interface to bounded per-case views. Transactional writes, strict validation, explicit
provenance, and idempotent event replay are required for safe retries. This ADR does not authorize
routines, briefings, refresh processes, proposals, forgetting, schedules, notifications, Task
creation, or live ingestion. Those require separate requirements and decisions.
