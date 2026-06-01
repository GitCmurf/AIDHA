---
document_id: AIDHA-RUNBOOK-006
owner: Ingestion Oncall
status: Draft
last_updated: 2026-06-01
version: '0.2'
title: LinkedIn Paste Bridge Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-006
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-06-01
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed LinkedIn paste-bridge runbook for the PLAN-007 LinkedIn vector. | — | Draft | — |
| 0.2     | 2026-06-01 | AI     | Add the generic activation handoff after LinkedIn paste ingestion. | — | Draft | AIDHA-TASK-010 |

## Purpose

Document the LinkedIn paste bridge, which accepts pasted post text without any
authenticated fetching or scraping.

## Operational Checklist

- **Prepare the paste**

  Paste the LinkedIn post text directly on the command line, or pipe it on stdin
  if the `--paste` flag is passed without a value.

- **Run the import**

  ```bash
  aidha ingest linkedin --paste "First paragraph.\n\nSecond paragraph." \
    --url https://www.linkedin.com/feed/update/urn:li:activity:1234567890/
  ```

  For stdin-driven usage:

  ```bash
  printf '%s' "First paragraph.\n\nSecond paragraph." | \
    aidha ingest linkedin --paste --url https://www.linkedin.com/feed/update/urn:li:activity:1234567890/
  ```

- **Review the output**

  The importer derives `linkedin:<activityUrn>` when the URL exposes a LinkedIn
  activity URN. Without a URL, it falls back to a hash of the pasted text. The
  decoded segments use `text` locators with deterministic char offsets.

- **Keep provenance explicit**

  `--url` is provenance only. No fetching happens in this plan, and the command
  should remain usable even when the pasted text is the only available source.

- **Hand off to activation**

  After ingest, use the generic activation commands rather than a source-specific
  workflow:

  ```bash
  aidha query "activation planning" --include-drafts --json
  aidha task create --from-claim <claim-id> --title "Follow up" --project <project-id> --json
  aidha project reentry --project <project-id> --markdown --out out/project-reentry.md
  aidha export graph --jsonld --out out/graph.jsonld
  ```

  `aidha task show <task-id> --json` should trace the Task back to Claim,
  Excerpt, and Resource evidence before the result is used in a pilot packet.
