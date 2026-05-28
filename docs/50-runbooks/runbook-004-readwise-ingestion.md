---
document_id: AIDHA-RUNBOOK-004
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: Readwise Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-004
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed Readwise batch-ingest runbook for the PLAN-007 Readwise vector. | — | Draft | — |

## Purpose

Document how to run the Readwise export ingest path, refresh the incremental
cursor, and validate the resulting summaries.

## Operational Checklist

- **Set the Readwise token**

  Use a token from config interpolation or a local environment variable.

  ```bash
  export READWISE_TOKEN=<token>
  ```

- **Run a bounded export**

  ```bash
  aidha ingest readwise --since 2026-05-01T00:00:00Z
  ```

  Add `--json` for machine-readable output.

- **Review summary output**

  The command prints the number of exported books and the number of processed
  summaries. Each book is processed with the shared `readwise` vector and keeps
  highlights on external `readwise` locators.

- **Re-run idempotently**

  Re-run with the same `--since` cursor if a batch is interrupted. The export
  helper pages through the API cursor deterministically and the vector keeps
  highlight identity stable on `highlightId`.
