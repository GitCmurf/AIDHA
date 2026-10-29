---
document_id: AIDHA-TESTING-077
owner: Engineering
status: Draft
version: '0.3'
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
> **Version:** 0.3
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# YouTube Transcript Acquisition Errors

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify preservation of transcript acquisition failures through the public ingestion command. | — | Draft | Original commit 85da451 |
| 0.2 | 2026-10-29 | Codex | Reconcile current main and verify the supported Node floor. | — | Draft | PR 47 |
| 0.3 | 2026-10-29 | Codex | Verify against the executable-test prerequisite and pin sources. | — | Draft | PR 47; PR 65 |

## Problem and scope

Before this change, the YouTube ingestor turned a failed transcript request into a successful
RawSource with a null transcript. The configured decoder then rejected that payload with a
generic missing-transcript error. This lost the acquisition error that could explain how to
fix the failure. Description-only ingestion is not a supported fallback in this vector.

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
[youtube-ingestor.test.ts](https://github.com/GitCmurf/AIDHA/blob/54f260de18359856e94a8aa1b3944640749f62da/packages/praecis/youtube/tests/ingest/youtube-ingestor.test.ts).
The production executable and reopened-store acceptance is in
[transcript-failure.test.ts](https://github.com/GitCmurf/AIDHA/blob/54f260de18359856e94a8aa1b3944640749f62da/packages/praecis/cli/tests/transcript-failure.test.ts).

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

## Current-base verification, 2026-10-29

After integrating PR 65, the complete YouTube package suite with one Vitest worker passes
1,149 tests with seven existing skips. The complete shared CLI suite passes 81 tests with
one existing skip. The previous nested-compiler setup timeout remains in the historical
evidence; its prerequisite is now handled by the package command before Vitest starts.

The boundary and built-executable regressions both fail when only the acquisition guard is
removed, then pass after restoration. Existing graph nodes and their relationship are
compared through a complete snapshot after the command exits and SQLite is reopened.
The [cookie-isolation regression](https://github.com/GitCmurf/AIDHA/blob/54f260de18359856e94a8aa1b3944640749f62da/packages/praecis/youtube/tests/real-client-config-isolation.test.ts)
uses an explicitly missing downloader path and a fresh promise-wrapped HTTP response.

All 96 current-main catalogue entries remain, with the intentional quickstart metadata update
and this additional testing page. The quickstart history renders 0.28, 0.29 and 0.38 in one
table. Production changes remain confined to failed transcript acquisition; live providers,
model quality and owner acceptance are outside these checks.
