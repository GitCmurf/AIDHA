---
document_id: AIDHA-TESTING-093
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-19
title: YouTube Creator Note Capture
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-093
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-19
> **Type:** TESTING

# YouTube Creator Note Capture

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-19 | Codex | Specify bounded watch capture and durable refresh checks | — | Draft | TESTING-094 |
| 0.2 | 2026-10-19 | Codex | Keep protocol ownership in YouTube and pin acceptance-test link to reviewed public commit | — | Draft | TESTING-094 |

## Contract

YouTube ingestion captures the literal creator description alongside transcript evidence. One
anonymous watch-page GET supplies optional description metadata while oEmbed remains authoritative
for title, channel name and thumbnail. Transcript and playlist acquisition keep their existing
configuration. This slice adds no notes generation, model selection or automatic link fetching.
Creator text remains untrusted source material.

The watch request omits credentials and uses manual redirects with its own headers. Caption cookies
never enter this request. A 15-second deadline covers its headers and complete streamed body.
The decoded response may contain at most 2 MiB, counted before retaining each chunk. Overflow,
redirects, non-success HTTP status, invalid UTF-8 and malformed player data are failed attempts.
The client aborts and cancels the owned reader on failure, observes cancellation rejection and
releases resources without awaiting an underlying cancellation hook indefinitely. If oEmbed fails,
the original primary error is preserved. oEmbed retains its existing unbounded request policy;
this is not a deadline for the complete metadata call.

The parser accepts a literal player object or immediate JSON.parse string at the assignment's
right-hand side without executing JavaScript or borrowing a later expression. Description is
accepted only when videoDetails.videoId exactly matches the requested video. A matching player
with nonempty text is available; an empty string is empty; an absent or null description is
unavailable. Missing or mismatched identity, consent HTML and nonstring descriptions are failures.
No publication date is inferred. Literal Unicode, line endings, repeated URLs and spelling survive.

New success and failure receipts use method youtube-watch-page. Version 1 also accepts yt-dlp for
existing carriers; an absent live method retains that legacy interpretation. Unknown methods fail
validation.
YouTube supplies this protocol's vocabulary to the reusable, source-neutral core contract factory.

## Persistence and refresh

The existing [source-owned metadata groups](testing-094-source-owned-metadata-groups.md) keep
three fields together: description, creatorNoteCapture and creatorNoteCaptureAttempt. The capture
records version, kind, originating canonical source ID, source URL, state, content SHA-256, identity
SHA-256 and injected capture time. Identity hashes ordered JSON fields schemaVersion, kind,
sourceCanonicalId, sourceUrl, state and contentSha256. Timestamps are excluded. The originating
canonical ID remains accurate when deduplication stores the Resource under another node ID.

Refresh outcomes are distinct:

- Available text replaces the description and capture.
- Empty text persists an empty string and an empty capture.
- Successful absence writes explicit null description and content hash with state unavailable.
- Failure records a current failed attempt and retains the last successful raw text and capture.
  Current extraction context withholds that retained text.

Stored CLI reconstruction also withholds text after failed or not_configured attempts and preserves
original receipts and timestamps. Its internal stored marker is not evidence of fresh acquisition.
The cached CLI still looks up the canonical YouTube Resource ID; alias refresh is covered separately.
A fresh legacy client supplying text without a carrier clears prior capture and attempt records
while preserving its supplied string, including empty text. An absent description retains omission
behaviour. Stored retrieval does not perform this legacy receipt clearing.

Successful current description enters the existing sourceSummary context. Claim citations remain
transcript-derived. No description-only subprocess or creator-linked destination is invoked.

## Acceptance and validation

The [public capture acceptance test][capture-test] uses RealYouTubeClient with controlled watch
and oEmbed responses, actual public ingestion, two recording fake mining calls, and file-backed
SQLite close and reopen. It
asserts exact raw description, independent content and identity hashes, attempt method, ownership
group and authoritative oEmbed fields. Every HTTP request is trapped. The initial failure must be
missing persisted description after successful ingestion and reopen, rather than setup or imports.

Focused controls cover available, empty, unavailable and failed acquisition; deadline and byte
bounds; delayed body and cancellation; wrong identity; literal and JSON.parse caption fallback;
canonical and alias refresh; fresh legacy transitions; and stored CLI reconstruction. Existing
publication-date and caption-cookie isolation checks remain applicable. Pure core tests protect the
version 1 hash wire, timestamp exclusion and accepted methods.

Run source builds, affected tests and strict affected-test type checks, package lint, scoped DocOps
and the full docs build before merge. Runtime fixtures prove transport and persistence mechanics;
they do not establish live caption timing or semantic note quality.

[capture-test]: https://github.com/GitCmurf/AIDHA/blob/64fe481b105fde42a4f1613281e6a71022ff1f78/packages/praecis/youtube/tests/watch-page-creator-capture.test.ts
