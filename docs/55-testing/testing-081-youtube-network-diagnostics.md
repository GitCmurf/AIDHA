---
document_id: AIDHA-TESTING-081
owner: Engineering
status: Draft
version: '0.6'
last_updated: 2026-10-29
title: YouTube Network Failure Diagnostics
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-081
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# YouTube Network Failure Diagnostics

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify bounded client failure context. | — | Draft | Original 2806fe4 |
| 0.2 | 2026-10-29 | Codex | Integrate current acquisition and optional creator-note boundaries. | — | Draft | PR 51 |
| 0.3 | 2026-10-29 | Codex | Pin complete current-base verification and reviewed test sources. | — | Draft | PR 51 |
| 0.4 | 2026-10-29 | Codex | Verify explicit helper bindings and dispose hosted findings. | — | Draft | PR 51 |
| 0.5 | 2026-10-29 | Codex | Reverify against the merged Vitest 4.1.11 baseline. | — | Draft | PR 51 |
| 0.6 | 2026-10-29 | Codex | Declare the segment helper before its first lexical use. | — | Draft | PR 51 |

## Problem and scope

Before this change, the public client could return an unlabelled fetch failure, while the final
transcript error retained only the last fallback error. Preserve operation and video context, make
immediate cause codes/messages readable through Error.message, and retain the original Error
objects. This is a client-side extraction of original commit 2806fe4, integrated with merged PR 47.
The metadata acquisition boundary propagates failed metadata Results unchanged. PR 47 protects the
transcript acquisition boundary separately; its executable regression does not constitute a live
network/provider verification of the combined diagnostic path.

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
[client-network-diagnostics.test.ts](https://github.com/GitCmurf/AIDHA/blob/b4d29a513d4d9a8198499cfa886a9307d2f6fcb0/packages/praecis/youtube/tests/client-network-diagnostics.test.ts).

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
and captions are used. PR 47 isolates the existing config-isolation regression from native
fallback, so the complete YouTube package suite can now run without excluding that file.

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
TypeScript, scoped DocOps and `pnpm docs:build`. Run the complete YouTube package suite offline.
Obtain independent review before commit.

## Current-base integration verification

Metadata acquisition now starts a separate creator-note watch request alongside oEmbed.
The initial integration reproduced six failures from stale full-module mocks and request
fixtures. The revised suite preserves the real error class, routes by URL and returns fresh
responses. It also verifies cancellation settles the watch task before an oEmbed failure is
returned, and that an optional creator-note failure does not turn successful metadata into
a failure. No production cancellation, fallback or success policy is changed.

The first full-suite run exposed three older creator-note test cases expecting the original
oEmbed Error at the top level. They now require the exact operation/video diagnostic and
the same original Error as its cause. Their cancellation, deadline, lock and timer assertions
remain intact. Dedicated segment controls also require one caption request and no extra
HTTP fallback, with fresh HTTP responses throughout their fixtures.

## Completed current-base verification, 2026-10-29

The complete YouTube package suite passes 1,163 tests with seven existing skips across
125 passing files and one skipped file. No file is excluded by the verification command.
The 14 dedicated diagnostics and 26 creator-note client cases also pass on official
Node 22.12.0 with its required SQLite flag, and on Node 22.21.1. Strict TypeScript for both
changed test files, affected build/lint, strict documentation build and scoped DocOps pass.

Removing the diagnostic changes reproduces ten failures among the dedicated cases;
restoration passes all 14. A separate mutation removing only the creator-note wait fails
the gated settlement regression; restoration passes. Existing cancellation, lock, deadline
and timer assertions are retained in the
[creator-note client controls](https://github.com/GitCmurf/AIDHA/blob/b4d29a513d4d9a8198499cfa886a9307d2f6fcb0/packages/praecis/youtube/tests/watch-page-creator-client.test.ts).

Native Claude review found no blocker and native CodeRabbit completed the seven-file
patch with zero findings. Independent specification and standards review found no remaining
material issue. These are offline diagnostic checks; no live provider or model-quality
result is claimed.

## Hosted review disposition

The completed DeepSource run on commit 3723e32 reported 16 Minor findings: nine module
function-declaration warnings, one void-operator warning in the promise observer and six
complexity advisories.
The nine private helpers now use const arrow bindings, with their bodies verified unchanged.
The settlement test observes and awaits its completion promise. All 1,163 package tests
pass again with the same seven skips; both affected client files pass all 40 cases again
on official Node 22.12.0. Strict tests and package lint also pass after this correction.

The six complexity advisories concern existing request/discovery methods. An independent
structural comparison with main e5e5bdb finds unchanged branch/loop counts and fewer
conditional expressions in those functions. This is supporting evidence, not a reproduction
of the provider metric or proof of full behavioural equivalence. The advisories remain
unsuppressed and are deferred to a separate maintainability slice. A failing JavaScript
analyser status is not represented as a passing check.

Native Claude review of the follow-up found no blocker, and native CodeRabbit completed
the two-file correction with zero findings. The complete seven-file patch was reviewed
separately by both tools. Independent specification and standards reviews also accepted
the bounded correction and advisory disposition. No broader refactoring is included.

## Merged runner baseline, 2026-10-29

Integration with main e3ddf73 includes the qualified Vitest 4.1.11 update from PR 25.
The three diagnostic production/test files are byte-identical to reviewed commit 12d092a;
the feature still changes the same seven paths relative to this new baseline.
The complete YouTube suite passes again: 1,163 tests, seven existing skips, 125 passing
files and one skipped file. Strict changed-test TypeScript and package lint pass.
All 40 focused diagnostic and creator-note client cases pass again on official
Node 22.12.0 with its required SQLite flag. No test exclusion, timeout increase or
assertion relaxation was introduced for this integration.

## Final helper declaration order

The completed hosted JavaScript analysis on 7bf325a reports the six retained complexity
advisories and one new JS-0357 finding: the segment helper's const declaration appears
below its first lexical reference. Move its entire unchanged declaration above that caller.
Its dependencies are existing function declarations or an already initialised helper;
the move adds no top-level request or other work.

After this move, all 93 selected client, transcript-parser and creator-note client cases
pass across four files. Strict changed-test TypeScript and package lint pass, and all 40
diagnostic/creator-note cases pass again on official Node 22.12.0. The preceding complete
1,163-test package run applies to 7bf325a; the final move is covered by these focused checks.
The six complexity advisories remain unsuppressed.
