---
document_id: AIDHA-RUNBOOK-012
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: Podcast Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-012
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed podcast-ingestion runbook for the PLAN-007 podcast vector. | — | Draft | — |

## Purpose

Ingest podcast feed episodes with show-note context, enclosure audio, optional
panel diarisation, and shared runtime export.

## Acceptance Criteria

- `podcast:` canonical identity is enclosure-URL based, with content-hash seams
  retained for downloaded media.
- Show notes flow into `ExtractionContext`.
- `--panel` produces speaker-labelled claims; mono episodes produce timecoded
  claims without diarisation.
- Cost ceiling coverage protects long-episode extraction at the shared runtime.
- Draft claims persist to the graph store.

## Test Coverage

- `packages/praecis/sources/feeds/tests/podcast-source.test.ts`
- `packages/praecis/decode/diarize/tests/backend-matrix.test.ts`
- `packages/praecis/core/tests/pipeline/cost-ceiling.test.ts`

## Operational Checklist

- Run an episode ingest:

  ```bash
  aidha ingest podcast --feed https://example.com/podcast.xml --episode episode-1 --json
  ```

- Use `--panel` for panel episodes that need diarisation. Show notes provide
  context; claims derive from timecoded audio segments.
- CI must mock feed, notes, and enclosure fetches.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/sources/feeds test
  pnpm -C packages/praecis/cli test
  ```
