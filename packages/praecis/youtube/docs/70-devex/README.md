---
document_id: PRAECIS-REF-001
owner: Praecis Maintainers
status: Draft
version: '0.3'
last_updated: 2026-10-16
title: YouTube Transcript Cue Cleanup
type: REF
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** PRAECIS-REF-001
> **Owner:** Praecis Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-16
> **Type:** REF

# YouTube Transcript Cue Cleanup

This folder contains **package-local** documentation for `packages/praecis/youtube/`.

Canonical repository docs live under `docs/` and are governed by Meminit DocOps 2.0.

## Version History

| Version | Date       | Author | Change Summary          | Reviewers | Status | Reference |
|---------|------------|--------|-------------------------|-----------|--------|-----------|
| 0.1     | 2025-12-30 | CMF    | Create package doc stub | —         | Draft  | —         |
| 0.2     | 2026-10-16 | AI     | Document VTT cue cleanup and source-fidelity tests | — | Draft | — |
| 0.3     | 2026-10-16 | AI     | Preserve cue literals and word boundaries; support both WebVTT timestamp forms | — | Draft | — |

## Canonical Docs

- Ingestion Quickstart: `../../../../docs/60-devex/ingest-quickstart.md`
- Ingestion Runbook: `../../../../docs/50-runbooks/runbook-003-youtube-ingestion.md`
- Document Standards: `../../../../docs/00-governance/gov-001-document-standards.md`

## WebVTT cue cleanup

The YouTube transcript parser removes inline WebVTT cue timestamps such as
`<00:02.000>` and `<100:00:02.000>` and formatting tags from cue text. It
recognizes the two timestamp forms defined by the
[WebVTT specification](https://www.w3.org/TR/webvtt1/): `mm:ss.mmm` and
`hh:mm:ss.mmm` with two or more hour digits. It strips raw timing and markup
before decoding a basic set of XML-style entities once. Escaped literals such
as `&lt;name&gt;` and `&lt;00:02.000&gt;` therefore remain visible text. Removing
a timing marker adds no whitespace: `inter<00:02.000>national` remains
`international`, while existing source spaces remain intact. The XML and TTML
parsers already decode their text before building a segment, so this cleanup
does not decode them again. JSON3 retains its existing text handling. Segment
start times and durations are unchanged.

The current decoder recognizes `&quot;`, `&#39;`, `&lt;`, `&gt;`, and `&amp;`.
The WebVTT specification calls for full HTML character-reference parsing;
numeric references such as `&#x27;` still need a dedicated decoder update.

The parser preserves repeated words within one cue and overlapping or adjacent
VTT and JSON3 cues. The original rolling-caption cleanup proposed deleting
these repetitions, but repetition and cue timing alone cannot distinguish a
caption artifact from intentional speech. That deduplication needs a separate,
evidence-backed design before it can be enabled.

Acceptance criteria and regression cases are in
[`tests/transcript-parse.test.ts`](../../tests/transcript-parse.test.ts): inline
raw inline timestamps disappear, escaped literals survive, words stay intact, entities are
decoded at most once per format, and repeated speech remains available for
source review.
