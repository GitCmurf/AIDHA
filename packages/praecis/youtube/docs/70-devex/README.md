---
document_id: PRAECIS-REF-001
owner: Praecis Maintainers
status: Draft
version: '0.2'
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
> **Version:** 0.2
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

## Canonical Docs

- Ingestion Quickstart: `../../../../docs/60-devex/ingest-quickstart.md`
- Ingestion Runbook: `../../../../docs/50-runbooks/runbook-003-youtube-ingestion.md`
- Document Standards: `../../../../docs/00-governance/gov-001-document-standards.md`

## WebVTT cue cleanup

The YouTube transcript parser removes inline WebVTT cue timestamps such as
`<00:00:01.200>` and formatting tags from cue text. It decodes XML-style
entities once in WebVTT cues. An encoded literal angle bracket remains text
after that single decode. The XML and TTML parsers already decode their text
before building a segment, so this cleanup does not decode them again. JSON3
retains its existing text handling. Segment start times and durations are
unchanged.

The parser preserves repeated words within one cue and overlapping or adjacent
VTT and JSON3 cues. The original rolling-caption cleanup proposed deleting
these repetitions, but repetition and cue timing alone cannot distinguish a
caption artifact from intentional speech. That deduplication needs a separate,
evidence-backed design before it can be enabled.

Acceptance criteria and regression cases are in
[`tests/transcript-parse.test.ts`](../../tests/transcript-parse.test.ts): inline
timestamps disappear, entities are decoded at most once per format, and
repeated speech remains available for source review.
