---
document_id: AIDHA-GUIDE-004
owner: Ingestion Team
status: Draft
version: '0.1'
last_updated: 2026-02-06
title: LLM Claim Extraction Guide
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-004
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-06
> **Type:** GUIDE

# LLM Claim Extraction Guide

## Version History

| Version | Date       | Author | Change Summary                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial LLM extraction guide            | —         | Draft  | —         |

## Purpose

Document LLM-specific extraction controls, cache behavior, and review workflow commands.

## Prerequisites

- Transcript excerpts available (`cli ingest video ...` completed)
- LLM endpoint configured:
  - `AIDHA_LLM_BASE_URL`
  - `AIDHA_LLM_API_KEY`
  - `AIDHA_LLM_MODEL` or `--model`

## Run Extraction

```bash
pnpm -C packages/praecis/youtube cli extract claims https://youtu.be/<id> \
  --llm \
  --model <model> \
  --claims 15 \
  --chunk-minutes 5 \
  --max-chunks 20
```

## Two-Pass Behavior

1. First pass (chunk miner):
   - extracts candidate claims with excerpt IDs
   - validates strict JSON schema
   - retries once on invalid structured output
2. Second pass (editor):
   - removes low-value/short candidates
   - deduplicates by text and excerpt overlap
   - selects stable, diverse final claim set

## Cache Semantics

- Default cache path: `./out/cache/claims`
- Cache metadata keys:
  - transcript hash
  - model
  - prompt version
  - chunk index/start/end
- Any mismatch forces recomputation and prevents stale reuse.

## Review and Curation Commands

```bash
pnpm -C packages/praecis/youtube cli review next https://youtu.be/<id> --state draft --limit 10
```

```bash
pnpm -C packages/praecis/youtube cli review apply \
  --claims <claimId1,claimId2> \
  --accept \
  --tag research,backend \
  --task-title "Follow up"
```

## Diagnostics

```bash
pnpm -C packages/praecis/youtube cli diagnose transcript https://youtu.be/<id>
pnpm -C packages/praecis/youtube cli diagnose extract https://youtu.be/<id>
```

`diagnose extract` reports claim state distribution, method counts, and provenance gaps.
