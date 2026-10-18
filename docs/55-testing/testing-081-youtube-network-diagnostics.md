---
document_id: AIDHA-TESTING-081
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: YouTube Network Failure Diagnostics
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-081
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# YouTube Network Failure Diagnostics

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify bounded client failure context. | — | Draft | Original 2806fe4 |

## Problem and scope

The public client can return an unlabelled fetch failure, while the final transcript error
retains only the last fallback error. Preserve operation and video context, make immediate
cause codes/messages readable through Error.message, and retain the original Error objects.
This is an independent client-side extraction of original commit 2806fe4. PR 47 preserves
client errors at the ingestion boundary; it is not a dependency of this diagnostic change.
The existing metadata acquisition boundary already propagates failed metadata Results unchanged.
Transcript diagnostics reaching the generic ingestion CLI still require PR 47 integration;
this standalone slice does not claim that end-to-end transcript behavior.

## Contract

Wrap caught exceptions at the oEmbed, timedtext track-list, segment fetch, get_transcript,
Innertube
caption-track, video-page caption-track and outer metadata/transcript boundaries. Labels
contain the operation and video ID, without adding request URLs, cookies or API keys.
Inspect only the immediate Error cause's code/message. Do not recursively serialize causes;
cyclic causes must terminate. Keep the original supplier Error as the wrapper's cause.

When caption discovery reaches a failed final timedtext Result, group the failed returned
Innertube (if attempted), HTML and timedtext errors as an AggregateError cause. The final
empty-transcript failure groups only failed returned discovery, get_transcript and yt-dlp
phases. Each group retains original error objects in attempted order; human-readable messages
are distinct at that group's level. Identical messages do not discard distinct Error objects.
This is bounded phase provenance, not an exhaustive history of every attempted request.

Keep successful Results, empty-success classification, fallback order and retry behavior
unchanged. Return immediately on a successful discovery phase. A thrown segment fetch still
reaches the outer transcript failure boundary; this slice does not add a later fallback for it.
Do not introduce models, Task writes, default extraction changes or live provider calls.

## Acceptance

The dedicated public-client suite is
`packages/praecis/youtube/tests/client-network-diagnostics.test.ts`.

- Metadata failure contains operation/video context and immediate DNS/code details, with
  original Error/cause identity preserved. Plain-object and cyclic causes are covered.
- Real client metadata diagnostics pass through YouTubeIngestor.acquire with the same wrapper
  and original cause, using public resolved config and an injected clock. Acquisition stops
  before transcript fetching; ordinary metadata success and HTTP-status failure stay unchanged.
- All mocked HTTP routes failing exposes labelled discovery and coarse phase groups, retains
  original causes and attempted order, and never invokes an installed native fallback.
- Successful HTML discovery after Innertube failure, and successful mocked yt-dlp recovery
  after HTTP failures, preserve their existing success outcomes and stopping points.
- Segment request/body-read failure adds no request URL, cookie or API-key value to labels
  and does not introduce
  a new retry/fallback attempt. Malformed metadata still fails at its outer boundary.
- Duplicate coarse messages remain readable without losing their distinct original errors.

All HTTP is mocked and the yt-dlp module is mocked in this file. Fictional IDs, credentials
and captions are used. Existing real-client config-isolation tests on this base can launch a
native fallback, so exclude that single unrelated file when running the broader offline suite.

## Original contract disposition

All original operation labels are retained, including both outer failure boundaries. The
original immediate-cause text formatter is replaced by a cause-preserving one-level formatter.
Original coarse transcript message aggregation is retained with structured causes; nested
failed discovery groups make its otherwise discarded HTML/Innertube labels observable only
when discovery as a whole fails. Success/fallback policy is unchanged. Original segment URL
inclusion is deliberately omitted because operation/video context is sufficient; no private
request material is added to labels. Arbitrary supplier messages and causes are retained;
this is not a general secret-sanitization guarantee. There is no remaining unaccounted-for
production hunk from original 2806fe4 within this bounded diagnostic contract.

## Validation

Record actual metadata RED/GREEN, then independent grouped-context RED/GREEN before completing
the slice. Run the dedicated public-client suite, affected package build/lint, strict changed-test
TypeScript, scoped DocOps and `pnpm docs:build`. Run broader YouTube coverage offline with the
single documented unsafe config-isolation file excluded. Obtain independent review before commit.
