---
document_id: AIDHA-TESTING-086
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-28
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
> **Version:** 0.2
> **Last Updated:** 2026-10-28
> **Type:** TESTING

# yt-dlp Leading-Hyphen Operands

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Protect leading-hyphen video IDs in yt-dlp fallback arguments. | — | Draft | AIDHA-TESTING-086 |
| 0.2 | 2026-10-28 | Codex | Refresh operand regression evidence. | Claude | Draft | PR 54 |

## Scope

The YouTube client accepts either a raw video ID or a watch URL. For a video ID beginning
with a hyphen, the transcript fallback must pass the ID as a positional operand rather than
letting yt-dlp parse it as an option. The client places the `--` option terminator before
that operand; configured yt-dlp options remain before the terminator.

## Acceptance and verification

- The [original public-client regression](https://github.com/GitCmurf/AIDHA/blob/ba27770ae003edf5c2c6b86e6a238174e8cc6f2b/packages/praecis/youtube/tests/ytdlp-leading-hyphen-operand.test.ts)
  exercises both a
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

## Refreshed verification on 2026-10-28

The current integration preserves main `0fd1ae3979b8c05222929ef2b113ff1f8caaacf5` and all
existing catalog entries. Removing only the production option terminator makes both public-client
cases fail with the fake downloader's option-parsing error. Restoring it passes the focused
regression and yt-dlp suite: 8 tests pass and 6 existing network tests remain skipped.

The fixture retains literal Bash substitutions using escaped template literals, uses four-space
Bash indentation, and returns a fresh Promise-wrapped response for each fake fetch call. These
changes preserve fixture behavior while addressing the static review observations. The frozen offline
dependency install, YouTube package build and package lint pass. Existing dependency build outputs
are reused from the successful current-main workspace build; their source files are unchanged.
No real downloader, provider or transcript request is exercised by these checks.
