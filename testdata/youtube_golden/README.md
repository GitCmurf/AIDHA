---
document_id: AIDHA-TESTDATA-001
owner: Ingestion Engineering
status: Draft
version: '0.2'
last_updated: 2026-05-12
title: YouTube Transcript Smoke Fixtures
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTDATA-001
> **Owner:** Ingestion Engineering
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-05-12
> **Type:** RUNBOOK

# YouTube Transcript Smoke Fixtures

## Version History

| Version | Date       | Author | Change Summary                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-02-08 | AI     | Initial golden fixture metadata + capture workflow | — | Draft | — |
| 0.2     | 2026-05-12 | AI     | Reframe committed YouTube fixtures as minimal Creative Commons transcript smoke tests. | — | Draft | AIDHA-TASK-001 |

## Purpose

Provide deterministic offline transcript fixtures for smoke-testing transcript parsing and
download-normalization behavior.

These files are intentionally not the main source of truth for extraction-quality golden tests.
Extraction edge cases such as enumeration, sponsor read-outs, show-note citations, fragments,
speaker attribution, and claim hierarchy should be covered with synthetic fixtures unless a real
source has explicit redistribution provenance recorded in the repository notice register.

Repository-level notice register:

- `docs/00-governance/gov-005-third-party-notices.md`

## Source Videos

- `https://www.youtube.com/watch?v=UepWRYgBpv0`

Licensing note:

- The committed source video was selected because it indicated Creative Commons licensing at
  capture time.
- Verify license status in YouTube metadata before adding or refreshing redistributed derived
  artifacts.

## Capture Metadata

- Fetched on: `2026-02-08`
- `yt-dlp` version: `2026.02.04`
- JS runtime flag: `--js-runtimes node`
- Subtitle selection: `--write-subs --write-auto-subs --sub-langs "en.*,en" --sub-format ttml`
- Normalized track committed: `en-orig`

## Committed Files

- `UepWRYgBpv0.excerpts.json`

Raw TTML files are intentionally excluded from git at
`testdata/youtube_golden/raw/`.

## Local Non-Committed Real-Video Work

Broader real-video experiments and candidate golden datasets should live outside committed fixture
paths until their provenance is settled. Use ignored directories such as:

- `testdata/youtube_local/`
- `testdata/nonredistributable/`

Use these local directories for:

- broader sets of identified YouTube videos;
- raw or normalized transcript captures without redistribution clearance;
- draft golden annotations derived from real videos;
- experiments that may later be converted into synthetic committed fixtures.

When a real-video artifact is promoted into the committed tree, first add source URL, capture date,
tool versions, authoring method, license/permission basis, and minimal-excerpt rationale to
`docs/00-governance/gov-005-third-party-notices.md`.

## Capture and Normalize Workflow

1. Capture raw TTML files:

   ```bash
   mkdir -p testdata/youtube_golden/raw

   yt-dlp --js-runtimes node --skip-download --write-subs --write-auto-subs \
       --sub-langs "en.*,en" --sub-format ttml \
       -o "testdata/youtube_golden/raw/%(id)s.%(ext)s" \
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
