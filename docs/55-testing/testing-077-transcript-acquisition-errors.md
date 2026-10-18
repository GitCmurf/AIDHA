---
document_id: AIDHA-TESTING-077
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: YouTube Transcript Acquisition Errors
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-077
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# YouTube Transcript Acquisition Errors

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify preservation of transcript acquisition failures through the public ingestion command. | — | Draft | Original commit 85da451 |

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
packages/praecis/youtube/tests/ingest/youtube-ingestor.test.ts. The production executable and
reopened-store acceptance is in packages/praecis/cli/tests/transcript-failure.test.ts.

Build the workspace, run the focused files, then the affected YouTube and CLI suites. Run package
lint, strict TypeScript for the changed tests, strict documentation build and scoped DocOps.
Review the complete slice before committing. This proves diagnostic preservation for the
specified failure; it does not establish a live model's semantic improvement.
