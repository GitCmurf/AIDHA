---
document_id: AIDHA-TESTING-006
owner: Product
status: Draft
version: '0.1'
last_updated: 2026-10-16
title: Viable Prototype Pilot Evidence Template
type: TESTING
docops_version: '2.0'
area: CORE
keywords: [prototype, pilot, activation, re-entry, evidence]
related_ids: [AIDHA-RUNBOOK-013]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-006
> **Owner:** Product
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-16
> **Type:** TESTING

# Testing: Viable Prototype Pilot Evidence Template

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-10-16 | AI     | Provide a private two-project pilot record with no public evidence-copy step. | — | Draft | AIDHA-RUNBOOK-013 |

## How to Use This Template

Copy this template to private storage before entering any real evidence. Follow
[the private pilot runbook](../50-runbooks/runbook-013-private-pilot-safety.md). Do not commit the
completed copy, command transcripts, graph exports, dossiers, screenshots, or source files. A public
summary may be written separately after manual sanitization.

Record actual implemented command paths and observed behavior. Mark unavailable capabilities as
such; this template does not imply that a planned command or integration has shipped.

## Setup

| Field | Private evidence |
| ----- | ---------------- |
| Run date and operator | [Date and role] |
| Dormant project | [Private project label] |
| Active project | [Private project label] |
| Source set | [Types, locations, and consent] |
| Store and configuration | [Private paths and settings] |
| Network or model use | [None, mock, or live service] |
| Code revision and deterministic baseline | [Revision and any applicable fixture packet] |

## Commands and Results

For each project, record the exact command, input source, output location, observed result, and
whether the result can be reproduced from a safe synthetic fixture. Keep this table private.

| Project | Command or step | Observation | Evidence location | Available? |
| ------- | --------------- | ----------- | ----------------- | ---------- |
| Dormant | [Step] | [Result] | [Private path] | [Yes/no] |
| Active | [Step] | [Result] | [Private path] | [Yes/no] |

## Evaluation

| Question | Dormant project | Active project |
| -------- | --------------- | -------------- |
| What useful prior context was found, and where did it come from? | [Evidence] | [Evidence] |
| Could the operator identify a plausible next action without re-reading every source? | [Evidence] | [Evidence] |
| Was any claim, source, or recommendation missing, noisy, duplicated, or misleading? | [Evidence] | [Evidence] |
| Were provenance and limits clear enough to trust the result? | [Evidence] | [Evidence] |
| What time or effort did the tool save or add? | [Evidence] | [Evidence] |

## Decision and Artifacts

- **Recommendation:** [Go / No-go / More evidence needed]
- **Reason:** [Evidence-based conclusion, including negative observations]
- **Next action:** [One concrete follow-up]
- **Private artifacts retained:** [Command transcript, source inventory, outputs, defects, and paths]
- **Public summary candidate:** [Only generalized findings after manual review]
