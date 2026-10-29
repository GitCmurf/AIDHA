---
document_id: AIDHA-TESTING-077
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-29
title: YouTube Transcript Acquisition Errors
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-077
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# YouTube Transcript Acquisition Errors

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify preservation of transcript acquisition failures through the public ingestion command. | — | Draft | Original commit 85da451 |
| 0.2 | 2026-10-29 | Codex | Reconcile current main and verify the supported Node floor. | — | Draft | PR 47 |

## Problem and scope

The YouTube ingestor currently turns a failed transcript request into a successful RawSource
with a null transcript. The configured transcript decoder then rejects that payload with a
generic missing-transcript error. This loses the acquisition error that can explain how to fix
the failure. Description-only ingestion is not a supported fallback in this vector.

Extract only the error propagation from original commit 85da451 onto current main. Preserve the
original Error object, including its cause, and return failure at acquisition. Keep metadata
failures and successful transcript ingestion unchanged. Broader network-error aggregation,
transcript caching, caption deduplication and model selection remain separate work.

## Acceptance criteria

- A failed transcript Result returns the same Error instance from YouTubeIngestor.acquire,
  without constructing a successful RawSource or replacing its diagnostic cause.
- The actual built aidha ingest youtube command exits nonzero and reports the mock client's
  transcript failure rather than a later missing-payload decode error.
- Reopen the temporary SQLite graph after that command. Existing nodes and edges must remain
  unchanged, and no successful source, Claim or Task may be added for the failed acquisition.
- Existing successful ingestion and video-metadata failure controls continue to pass.
- All acceptance uses explicit mock clients and isolated temporary data. No model default,
  Task authority, retry policy or live provider call changes.

## Verification

The boundary and object-identity regression is in
[youtube-ingestor.test.ts](https://github.com/GitCmurf/AIDHA/blob/50719ad71f78235ddb615864e3e073d0b4c65fb4/packages/praecis/youtube/tests/ingest/youtube-ingestor.test.ts).
The production executable and reopened-store acceptance is in
[transcript-failure.test.ts](https://github.com/GitCmurf/AIDHA/blob/50719ad71f78235ddb615864e3e073d0b4c65fb4/packages/praecis/cli/tests/transcript-failure.test.ts).

Build the workspace, run the focused files, then the affected YouTube and CLI suites. Run package
lint, strict TypeScript for the changed tests, strict documentation build and scoped DocOps.
Review the complete slice before committing. This proves diagnostic preservation for the
specified failure; it does not establish a live model's semantic improvement.

## Supported-runtime verification, 2026-10-29

The repository floor is Node 22.12.0. Its SQLite API requires the
[experimental SQLite flag](https://nodejs.org/download/release/v22.12.0/docs/api/sqlite.html).
The executable regression deliberately isolates the child environment, so it must pass that flag
explicitly rather than depend on inherited NODE_OPTIONS. The original child invocation failed
with the SQLite-unavailable diagnostic on official Node 22.12.0; adding the flag makes the
acquisition-diagnostic and complete reopened-graph assertions pass unchanged.

These are synthetic, offline failure-path checks. The cookie-isolation regression supplies a
missing downloader path so a mocked HTTP failure cannot invoke installed native yt-dlp.
No live provider result, model quality improvement or new ingestion fallback is claimed.
