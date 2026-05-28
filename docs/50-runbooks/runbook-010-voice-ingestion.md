---
document_id: AIDHA-RUNBOOK-010
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: Voice Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-010
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed voice-ingestion runbook for the PLAN-007 voice vector. | — | Draft | — |

## Purpose

Ingest private voice notes with content-hash identities, mockable transcription,
and timecoded locators.

## Acceptance Criteria

- `voice:` canonical identity is SHA-256 content-hash based.
- Timecode locators are present on excerpts.
- CI uses deterministic mock transcription.
- Draft claims persist to the graph store.
- Cost ceiling and sensitivity gates remain covered at the shared runtime.

## Test Coverage

- `packages/praecis/decode/transcribe/tests/transcribe.test.ts`
- `packages/praecis/decode/transcribe/tests/backend-matrix.test.ts`
- `packages/praecis/sources/voice/tests/voice-source.test.ts`
- `packages/praecis/core/tests/pipeline/cost-ceiling.test.ts`
- `packages/praecis/core/tests/pipeline/sensitivity-gate.test.ts`

## Operational Checklist

- Run a local audio ingest:

  ```bash
  aidha ingest voice --file ./fixtures/note.m4a --json
  ```

- Confirm `voice:` identity, timecode locators, draft claims, and a local/offline
  policy route unless a cloud route is intentionally configured.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/decode/transcribe test
  pnpm -C packages/praecis/sources/voice test
  ```
