---
document_id: AIDHA-RUNBOOK-005
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: Email Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-005
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed email file-import runbook for the PLAN-007 email vector. | — | Draft | — |

## Purpose

Document the `.eml` file-import path, thread reconstruction behavior, and the
operational checks to run after an email batch import.

## Operational Checklist

- **Prepare the input**

  Use a single `.eml` file or a directory of `.eml` messages. The importer
  walks directories recursively and groups messages into threads by message
  references.

- **Run the batch import**

  ```bash
  aidha ingest email --file ./fixtures/email-thread/
  ```

  Add `--json` when the output needs to be consumed by a script or regression
  check.

- **Check the summary**

  The batch summary reports how many files were imported, how many threads were
  reconstructed, and the canonical thread ids. Reply stripping is deterministic,
  so repeated runs over the same fixture should produce the same thread summary.

- **Validate reparenting**

  If a child message arrives before its root, the importer rethreads the
  provisional `email:thread:<inReplyTo>` group onto the later-discovered
  `email:thread:<trueRootMessageId>` identity.

- **Review attachments**

  Attachments are preserved in parsed metadata, but they are not auto-ingested.
  Record any follow-up extraction work explicitly.
