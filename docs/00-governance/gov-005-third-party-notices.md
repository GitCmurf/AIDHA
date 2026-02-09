---
document_id: AIDHA-GOV-005
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-02-09
title: Third-Party Notices
type: GOV
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-005
> **Owner:** Engineering
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-02-09
> **Type:** GOV

# Third-Party Notices

## Version History

| Version | Date       | Author | Change Summary                    | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-08 | AI     | Initial third-party notices register | —       | Draft  | —         |
| 0.2     | 2026-02-09 | AI     | Align with GOV type and add fixture governance context | — | Draft | — |

## Purpose

Document third-party materials included in this repository and the usage basis
for engineering and test fixtures.

## Registered Notices

### YouTube golden transcript fixtures

- Location:
  - `testdata/youtube_golden/IN6w6GnN-Ic.excerpts.json`
  - `testdata/youtube_golden/UepWRYgBpv0.excerpts.json`
- Source URLs:
  - `https://www.youtube.com/watch?v=IN6w6GnN-Ic`
  - `https://www.youtube.com/watch?v=UepWRYgBpv0`
- Capture details:
  - Fetched with `yt-dlp` using transcript/caption export workflow.
  - Normalized into deterministic excerpt JSON for offline tests.
  - Fixture generation is documented in
    `packages/praecis/youtube/ops/capture-golden-fixtures.sh`.
- Declared status:
  - Source videos indicate Creative Commons licensing; verify status in source metadata before redistribution.
- Operational note:
  - Raw downloaded subtitle artifacts are not committed; only normalized fixture
    JSON and metadata are stored.

## Maintenance

When adding new third-party fixture data:

1. Add an entry to this register.
2. Include source URL, capture date, tool versions, and usage basis.
3. Keep only the minimum stable artifact needed for deterministic tests.
