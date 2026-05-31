---
document_id: AIDHA-TESTING-005
owner: Product
status: Draft
version: "0.3"
last_updated: 2026-06-01
title: Viable Prototype Activation Acceptance Run
type: TESTING
docops_version: "2.0"
area: CORE
keywords: [prototype, acceptance, activation]
related_ids: [AIDHA-TASK-010, AIDHA-PLAN-008]
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-005
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-06-01
> **Type:** TESTING

# Testing: Viable Prototype Activation Acceptance Run

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-31 | AI     | Record deterministic activation acceptance packet for TASK-010 viable tranche. | - | Draft | AIDHA-TASK-010 |
| 0.2     | 2026-05-31 | AI     | Update packet evidence to use generic PDF and LinkedIn ingests with deterministic `--mock-llm` extraction. | - | Draft | AIDHA-TASK-010 |
| 0.3     | 2026-06-01 | AI     | Add packet artifact validation and rerun summary evidence. | - | Draft | AIDHA-TASK-010 |

This packet proves a no-network activation loop against a fresh local SQLite graph populated by two
generic CLI ingests.

- Query retrieves Claims produced by both generic ingests.
- Review surfaces distinct editorial and routing axes.
- Task creation links Task -> Claim.
- Task show and project re-entry trace Claim -> Excerpt -> Resource provenance.
- Packet validation rejects missing, empty, or local-machine-only artifacts.
- Rerun summary proves the scenario is deterministic across fresh local stores.

## Acceptance Artifacts

- Script: `scripts/acceptance/viable-prototype-activation.mjs`
- Command transcript: `docs/55-testing/acceptance-run-20260531/command-transcript.json`
- PDF fixture: `docs/55-testing/acceptance-run-20260531/fixture-prototype.pdf`
- Store summary: `docs/55-testing/acceptance-run-20260531/store-summary.json`
- Rerun summary: `docs/55-testing/acceptance-run-20260531/rerun-summary.json`
- Re-entry dossier: `docs/55-testing/acceptance-run-20260531/project-reentry.txt`
