---
document_id: AIDHA-FDD-001
owner: Ingestion Engineering Lead
status: Draft
last_updated: 2026-02-10
version: '0.3'
title: Ingestion Engine Design
type: FDD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-FDD-001
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-02-10
> **Type:** FDD

## Version History

| Version | Date       | Author | Change Summary                                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Placeholder FDD created                                  | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0 (ID + metadata + filename) | —         | Draft  | —         |
| 0.3     | 2026-02-10 | AI     | Reconcile FDD with implemented ingestion pipeline and CLI | — | Draft | — |

## Overview

The ingestion engine accepts playlist/video targets, resolves transcript content, and writes
deterministic graph nodes for downstream extraction/review/export workflows.

Primary implementation package:

- `packages/praecis/youtube`

## Interfaces

### CLI Commands

- `cli ingest playlist <playlistIdOrUrl>`
- `cli ingest video <videoIdOrUrl>`
- `cli ingest status <videoIdOrUrl> [--json]`
- `cli diagnose transcript <videoIdOrUrl>`
- `cli preflight youtube [--probe-url <url>] [--json]`

### Core dependencies

- `GraphStore` (`@aidha/graph-backend`) for deterministic persistence.
- YouTube client implementations:
  - `RealYouTubeClient`
  - `MockYouTubeClient`
- Transcript fallback tooling: `yt-dlp` (external binary, optional but recommended).

## Data Contracts

### Resource node

- ID: `youtube-<videoId>`
- Type: `Resource`
- Key metadata:
  - `videoId`, `url`, `channelName`, `publishedAt`
  - `transcriptStatus` (`available|missing`)
  - `transcriptError` (when missing)

### Excerpt node

- ID: deterministic hash from `(resourceId, start, duration, text, sequence)`.
- Type: `Excerpt`
- Key metadata:
  - `resourceId`, `videoId`, `start`, `duration`, `sequence`

## Processing Flow

1. Parse input ID/URL and normalize video/playlist identifiers.
2. Fetch video/playlist metadata.
3. Retrieve transcript via primary client path.
4. If transcript retrieval fails, attempt fallback with `yt-dlp`.
5. Upsert resource and excerpt nodes with no-op detection.
6. Persist transcript diagnostics metadata for later inspection.

## Failure and Retry Behavior

- Transcript failures do not crash graph schema operations.
- Missing transcript is represented explicitly on the resource.
- Fallback and preflight diagnostics provide actionable messages.
- Re-running ingest on unchanged input remains idempotent.

## Testing

Implemented coverage includes:

- `tests/pipeline.test.ts`: ingest flow for video/playlist and graph writes.
- `tests/client.test.ts`: YouTube client behavior and metadata handling.
- `tests/yt-dlp.test.ts`: fallback runtime wiring and transcript fallback behavior.
- `tests/status.test.ts` and `tests/status-format.test.ts`: ingest status output.
- `tests/cli-preflight.test.ts`: environment/tooling preflight checks.

## Operational Notes

- Default DB path: `./out/aidha.sqlite`.
- Export and review pipelines depend on successful `Resource` + `Excerpt` ingestion.
- In non-production workflows, stale claims can be cleared via:
  - `cli claims purge <videoIdOrUrl>`
  while preserving ingested transcript data.
