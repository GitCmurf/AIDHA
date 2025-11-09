---
document_id: AIDHA-GOV-005
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-02-24
title: Third-Party Notices
type: GOV
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-005
> **Owner:** Engineering
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-02-24
> **Type:** GOV

# Third-Party Notices

## Version History

| Version | Date       | Author | Change Summary                    | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-08 | AI     | Initial third-party notices register | —       | Draft  | —         |
| 0.2     | 2026-02-09 | AI     | Align with GOV type and add fixture governance context | — | Draft | — |
| 0.3     | 2026-02-24 | AI     | Add explicit redistribution verification and acceptance-run coverage guidance | — | Draft | — |

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
  - Raw downloaded subtitle artifacts are not committed; only normalized fixture
    JSON and metadata are stored.

### Acceptance run artifacts derived from transcripts

- Location:
  - `docs/55-testing/acceptance-run-*/`
- Declared status:
  - These documents may contain transcript-derived excerpts and therefore inherit the same
    redistribution constraints as their source content.
  - Before making this repository public, either:
    - verify the source content is licensed for redistribution, or
    - redact/remove transcript-derived excerpts from the acceptance-run docs.

## Maintenance

When adding new third-party fixture data:

1. Add an entry to this register.
2. Include source URL, capture date, tool versions, and usage basis.
3. Keep only the minimum stable artifact needed for deterministic tests.
