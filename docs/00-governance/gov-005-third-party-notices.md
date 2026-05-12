---
document_id: AIDHA-GOV-005
owner: Engineering
status: Draft
version: '0.5'
last_updated: 2026-05-12
title: Third-Party Notices
type: GOV
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-005
> **Owner:** Engineering
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.5
> **Last Updated:** 2026-05-12
> **Type:** GOV

# Third-Party Notices

## Version History

| Version | Date       | Author | Change Summary                    | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-08 | AI     | Initial third-party notices register | —       | Draft  | —         |
| 0.2     | 2026-02-09 | AI     | Align with GOV type and add fixture governance context | — | Draft | — |
| 0.3     | 2026-02-24 | AI     | Add explicit redistribution verification and acceptance-run coverage guidance | — | Draft | — |
| 0.4     | 2026-05-12 | AI     | Add public-readiness fixture inventory and provenance status. | — | Draft | AIDHA-TASK-001 |
| 0.5     | 2026-05-12 | AI     | Clarify committed versus local real-video fixture policy. | — | Draft | AIDHA-TASK-001 |

## Purpose

Document third-party materials included in this repository and the usage basis
for engineering and test fixtures.

## Registered Notices

### NPM Dependencies

- A dependency license audit was conducted on 2026-02-27.
- All transitive dependencies across the workspace packages use permissive licenses
  (MIT, ISC, BSD-3-Clause, Apache-2.0, Python-2.0).
- No GPL or incompatible licenses were found.
- The project's dependencies are fully compatible with its Apache 2.0 license.

### YouTube golden transcript fixtures

- Location:
  - `testdata/youtube_golden/UepWRYgBpv0.excerpts.json`
- Source URLs:
  - `https://www.youtube.com/watch?v=UepWRYgBpv0`
- Capture details:
  - Fetched with `yt-dlp` using transcript/caption export workflow.
  - Normalized into deterministic excerpt JSON for offline tests.
  - Fixture generation is documented in
    `packages/praecis/youtube/ops/capture-golden-fixtures.sh`.
- Declared status:
  - Source video was selected as Creative Commons-licensed at the time of capture.
  - Verified license metadata prior to public release.
- Operational note:
  - Raw downloaded subtitle artifacts are not committed; only normalized fixture JSON and metadata
    are stored.
  - This fixture exists to smoke-test transcript download/parsing behavior, not to serve as the
    primary extraction-quality golden dataset.
  - Keep at least one, and preferably two, Creative Commons-licensed YouTube transcript fixtures for
    continued transcript-download coverage.

### Synthetic eval-matrix fixtures

- Locations:
  - `packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json`
  - `packages/praecis/youtube/tests/fixtures/eval-matrix/baseline-report.json`
  - `packages/praecis/youtube/tests/fixtures/eval-matrix/transcript-excerpts/short_solo_1.json`
- Declared status:
  - Synthetic / internally authored test data.
  - Some entries intentionally use placeholder YouTube-style IDs or URLs to exercise schema and
    routing behavior. They are not redistributed transcript captures.
- Operational note:
  - Prefer synthetic entries for new golden tests unless a real source has explicit redistribution
    permission and is registered here.
  - Extraction-quality golden tests should primarily use synthetic fixtures that deliberately cover
    important edge cases such as enumeration, sponsor read-outs, show-note citations, fragments,
    speaker attribution, and claim hierarchy.

### Eval annotation fixtures requiring provenance closure

- Locations:
  - `packages/praecis/youtube/tests/fixtures/extraction-golden/h_1zlead9ZU.samples.json`
  - `packages/praecis/youtube/tests/fixtures/eval-matrix/golden-annotations.json`
- Declared status:
  - Needs follow-up before public-release checklist closure.
  - The fixtures include real video IDs, real channel/person names, or content-derived claim
    examples without enough provenance metadata in this register.
- Required closure:
  - Replace with synthetic fixtures where possible; or
  - add source URL, capture date, authoring method, license/permission basis, and minimal-excerpt
    rationale before treating them as redistribution-safe.

### Acceptance run artifacts derived from transcripts

- Location:
  - `docs/55-testing/acceptance-run-*/`
- Declared status:
  - These documents may contain transcript-derived excerpts and therefore inherit the same
    redistribution constraints as their source content.
  - Before making this repository public, either:
    - verify the source content is licensed for redistribution, or
    - redact/remove transcript-derived excerpts from the acceptance-run docs.

### Public-readiness fixture audit summary

As of 2026-05-12, fixture redistribution is intentionally still open in `AIDHA-TASK-001`. The
project should not close that public-release gate until the eval annotation fixtures and
acceptance-run artifacts above are either replaced with synthetic data or have explicit provenance
records in this notice register.

Broader real-video evaluation sets may be useful for private development, but they should live in
ignored local directories such as `testdata/youtube_local/` or `testdata/nonredistributable/` until
their redistribution basis is settled.

## Maintenance

When adding new third-party fixture data:

1. Add an entry to this register.
2. Include source URL, capture date, tool versions, and usage basis.
3. Keep only the minimum stable artifact needed for deterministic tests.
