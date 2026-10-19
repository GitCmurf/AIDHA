---
document_id: AIDHA-TESTING-092
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Truthful YouTube Publication Dates
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-092
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Truthful YouTube Publication Dates

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify unknown publication dates and production-path regressions | — | Draft | PLAN-015 |

## Confirmed problem

The real client's oEmbed response has no publication date, but `fetchVideo` substitutes the
current clock. Ingestion persists that value as `Resource.metadata.publishedAt`. The stored-video
CLI reconstructs an absent date as 1970. These are fabricated publication metadata, not evidence
of when a source was published. Current source searches found no model-prompt/date-filter use;
historical downstream impact is unverified.

## Contract and acceptance

- A Video may omit its publication date. A supplied date must still be a valid ISO timestamp.
- oEmbed metadata supplies no date: return an unknown value without substituting the clock.
- Ingestion time remains in source provenance from the injected clock. Persist a known supplied
  date unchanged, or JSON `null` for an unknown current publication date. Explicit `null` prevents
  the existing metadata merge from retaining a stale date after successful re-acquisition.
- The actual stored-video extraction CLI must preserve unknown dates without an epoch fallback
  or network fetch when saved transcript evidence is available.
- Do not rewrite existing databases or claim that old recorded timestamps have been verified.
  A successful re-acquisition refreshes the current field. No description fetching, linked-page
  retrieval, model change or paid call is part of this correction.

`packages/praecis/youtube/tests/publication-date.test.ts` covers schema validation, the real client
with injected HTTP responses, configured ingestion through a fresh SQLite reopen, a known-to-unknown
refresh and the actual extraction CLI with saved transcript evidence. Transcripts and model responses
are offline fixtures; HTTP requests are restricted to stubbed oEmbed responses and destination requests
are forbidden.

## Verification

Run the new regression against unchanged production code first, preserving its actual failure.
Then run affected client/schema/ingestion/CLI tests, required package lint/build, changed-test strict
checks, scoped DocOps, Markdownlint and `pnpm docs:build`. Review all material source changes before
commit. Record reused source-bound dependencies and any incomplete or failed checks honestly.
