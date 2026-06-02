---
document_id: AIDHA-TESTING-006
owner: Product
status: Draft
version: "0.2"
last_updated: 2026-06-02
title: Viable Prototype Pilot Evidence Template
type: TESTING
docops_version: "2.0"
area: CORE
keywords: [prototype, pilot, activation, re-entry, evidence]
related_ids: [AIDHA-PLAN-008, AIDHA-TASK-010, AIDHA-TESTING-005, AIDHA-RUNBOOK-013]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-006
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-06-02
> **Type:** TESTING

# Testing: Viable Prototype Pilot Evidence Template

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.2     | 2026-06-02 | AI     | Link pilot evidence capture to the private pilot safety boundary. | - | Draft | AIDHA-RUNBOOK-013 |
| 0.1     | 2026-06-01 | AI     | Add reusable evidence template for the two-project viable-prototype pilot. | - | Draft | AIDHA-TASK-010 |

## Purpose

Use this template for the first real two-project viable-prototype pilot. The pilot is product
evidence, not a benchmark: it should show whether AIDHA helps a user re-enter real work from prior
claims and sources without manually reconstructing context first.

For private real-source pilots, copy this document to private storage governed by AIDHA-RUNBOOK-013,
then replace bracketed placeholders with observed evidence. Keep raw command transcripts, generated
re-entry dossiers, graph exports, store summaries, screenshots, and JSON summaries private unless a
separate public summary has been sanitized.

## Pilot Setup

| Field | Evidence |
| ----- | -------- |
| Run date | [YYYY-MM-DD] |
| Operator | [Name or role] |
| Dormant project | [Project name and project ID] |
| Active project | [Project name and project ID] |
| Source set | [Brief list of sources and source types] |
| Fresh store? | [Yes/no, plus store path policy. Do not record local-only private paths in committed docs.] |
| Network/live model use | [None/mock/live model, with reason] |
| Acceptance packet baseline | [Link to AIDHA-TESTING-005 or newer deterministic packet] |

## Commands Run

Record the exact command path used for each project. Prefer generic `aidha` commands where parity
exists.

```bash
# ingest sources
[commands]

# inspect candidate claims
[commands]

# generate project re-entry dossier
[commands]

# create or confirm task from claim
[commands]

# inspect task provenance
[commands]
```

## Dormant Project Evidence

| Question | Evidence |
| -------- | -------- |
| Did `aidha project reentry` produce a plausible next action before reopening original sources? | [Yes/no plus quote or concise summary from dossier] |
| Which prior Claim, source, or Task avoided re-derivation? | [IDs and short explanation] |
| Which Task was created or confirmed? | [Task ID] |
| Does `aidha task show <taskId>` trace to Claim -> Excerpt -> Resource? | [Yes/no plus IDs] |
| What was missing, noisy, duplicated, or misleading? | [Observed issue list] |
| Time from first re-entry command to plausible next action | [Duration] |

## Active Project Evidence

| Question | Evidence |
| -------- | -------- |
| Did `aidha project reentry` produce a plausible next action before reopening original sources? | [Yes/no plus quote or concise summary from dossier] |
| Which prior Claim, source, or Task avoided re-derivation? | [IDs and short explanation] |
| Which Task was created or confirmed? | [Task ID] |
| Does `aidha task show <taskId>` trace to Claim -> Excerpt -> Resource? | [Yes/no plus IDs] |
| What was missing, noisy, duplicated, or misleading? | [Observed issue list] |
| Time from first re-entry command to plausible next action | [Duration] |

## Go/No-Go Assessment

Mandatory go criteria from AIDHA-PLAN-008:

- [ ] At least one project produced a plausible next action from `aidha project reentry` without
  manually reopening original source material first.
- [ ] At least one Task was created or confirmed from a prior Claim.
- [ ] `aidha task show <taskId>` traced that Task to Claim -> Excerpt -> Resource provenance.
- [ ] The dossier surfaced at least one prior source, claim, or task that otherwise would have
  required manual search or re-derivation.
- [ ] The command path and evidence packet are reproducible enough for a coding agent to rerun or
  inspect.
- [ ] Useful and noisy outputs are both recorded.

Decision:

- **Recommendation:** [Go / No-go / Not yet baseline candidate]
- **Reason:** [Concise evidence-based rationale]
- **Required follow-up before baseline tag:** [Tasks or none]

## Artifact Checklist

- [ ] Copied pilot evidence doc.
- [ ] Command transcript.
- [ ] Project re-entry dossier for dormant project.
- [ ] Project re-entry dossier for active project.
- [ ] Task context output for at least one provenance-backed Task.
- [ ] Store summary or graph snapshot with local-only paths redacted.
- [ ] Release-note draft records useful and noisy outputs.
