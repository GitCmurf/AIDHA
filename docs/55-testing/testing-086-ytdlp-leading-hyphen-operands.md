---
document_id: AIDHA-TESTING-086
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: yt-dlp Leading-Hyphen Operands
type: TESTING
docops_version: '2.0'
area: INGEST
related_ids: [AIDHA-TESTING-001]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-086
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# yt-dlp Leading-Hyphen Operands

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Protect leading-hyphen video IDs in yt-dlp fallback arguments. | — | Draft | AIDHA-TESTING-086 |

## Scope

The YouTube client accepts either a raw video ID or a watch URL. For a video ID beginning
with a hyphen, the transcript fallback must pass the ID as a positional operand rather than
letting yt-dlp parse it as an option. The client places the `--` option terminator before
that operand; configured yt-dlp options remain before the terminator.

## Acceptance and verification

- `packages/praecis/youtube/tests/ytdlp-leading-hyphen-operand.test.ts` exercises both a
  leading-hyphen raw ID and its equivalent watch URL through the public `RealYouTubeClient`.
- The test mocks caption-fetch misses and uses a temporary fake executable that rejects a
  leading-hyphen final argument unless preceded by `--`. It verifies the transcript result,
  configured arguments before the terminator, and the exact ID after it.
- This test makes no network request and does not invoke a real yt-dlp downloader or fetch a
  real transcript. A separate parser-only check with yt-dlp's native argument parser can
  verify option parsing without running a download.
- Run the focused tests with:

  ```sh
  pnpm --filter @aidha/ingestion-youtube exec vitest run \
    tests/ytdlp-leading-hyphen-operand.test.ts tests/yt-dlp.test.ts
  ```

- Run the package type check/build and the repository documentation build before review.
