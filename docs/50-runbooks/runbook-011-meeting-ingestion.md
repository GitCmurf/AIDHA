---
document_id: AIDHA-RUNBOOK-011
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: Meeting Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-011
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed meeting-ingestion runbook for the PLAN-007 meeting vector. | — | Draft | — |

## Purpose

Run confidential meeting audio through transcription, diarisation, sensitivity
gating, and speaker-labelled claim export.

## Acceptance Criteria

- `meeting:` identity is SHA-256 audio content-hash based.
- Timecode locators include speaker labels after diarisation.
- Speaker labels survive into runtime excerpts and draft claims.
- Confidential meetings fail closed when policy routes them to cloud or disables
  extraction.
- Mock transcribe plus diarize pipelines produce speaker-annotated segments.

## Test Coverage

- `packages/praecis/decode/transcribe/tests/backend-matrix.test.ts`
- `packages/praecis/decode/diarize/tests/backend-matrix.test.ts`
- `packages/praecis/sources/meetings/tests/meeting-source.test.ts`
- `packages/praecis/sources/meetings/tests/speaker-locator.test.ts`
- `packages/praecis/core/tests/pipeline/sensitivity-gate.test.ts`

## Operational Checklist

- Run a local meeting ingest:

  ```bash
  aidha ingest meeting --file ./fixtures/standup.wav --json
  ```

- Confidential meetings must fail closed when policy routes confidential content
  to cloud or disables extraction.
- Confirm speaker labels survive into timecode locators and excerpts.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/decode/transcribe test
  pnpm -C packages/praecis/decode/diarize test
  pnpm -C packages/praecis/sources/meetings test
  ```
