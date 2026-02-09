---
document_id: AIDHA-TESTDATA-001
owner: Ingestion Engineering
status: Draft
version: '0.1'
last_updated: 2026-02-08
title: YouTube Golden Transcript Fixtures
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTDATA-001
> **Owner:** Ingestion Engineering
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-08
> **Type:** RUNBOOK

# YouTube Golden Transcript Fixtures

## Version History

| Version | Date       | Author | Change Summary                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-02-08 | AI     | Initial golden fixture metadata + capture workflow | — | Draft | — |

## Purpose

Provide deterministic offline transcript fixtures for golden extraction tests.

Repository-level notice register:

- `docs/00-governance/gov-005-third-party-notices.md`

## Source Videos

- `https://www.youtube.com/watch?v=IN6w6GnN-Ic`
- `https://www.youtube.com/watch?v=UepWRYgBpv0`

Licensing note:

- Both source videos were selected because they indicate Creative Commons licensing.
- Verify license status in YouTube metadata before redistributing derived artifacts.

## Capture Metadata

- Fetched on: `2026-02-08`
- `yt-dlp` version: `2026.02.04`
- JS runtime flag: `--js-runtimes node`
- Subtitle selection: `--write-subs --write-auto-subs --sub-langs "en.*,en" --sub-format ttml`
- Normalized track committed: `en-orig`

## Committed Files

- `IN6w6GnN-Ic.excerpts.json`
- `UepWRYgBpv0.excerpts.json`

Raw TTML files are intentionally excluded from git at
`testdata/youtube_golden/raw/`.

## Capture and Normalize Workflow

1. Capture raw TTML files:

   ```bash
   mkdir -p testdata/youtube_golden/raw

   yt-dlp --js-runtimes node --skip-download --write-subs --write-auto-subs \
       --sub-langs "en.*,en" --sub-format ttml \
       -o "testdata/youtube_golden/raw/%(id)s.%(ext)s" \
       "https://www.youtube.com/watch?v=IN6w6GnN-Ic" \
       "https://www.youtube.com/watch?v=UepWRYgBpv0"
   ```

2. Normalize TTML to deterministic excerpt JSON:

   ```bash
   pnpm -C packages/praecis/youtube build
   bash packages/praecis/youtube/ops/capture-golden-fixtures.sh --normalize-only
   ```

3. Run golden tests offline:

   ```bash
   pnpm -C packages/praecis/youtube test -- tests/golden-fixtures.test.ts
   ```
