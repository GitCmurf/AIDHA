---
document_id: AIDHA-RUNBOOK-009
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: RSS Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-009
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed RSS-ingestion runbook for the PLAN-007 RSS vector. | — | Draft | — |

## Purpose

Ingest feed items through the shared web identity model so RSS and Readwise can
merge or link around the same article.

## Acceptance Criteria

- Feed items with article links use `web:<canonicalUrl>` as the primary identity.
- Feed GUIDs are stored as dedup/provenance keys, not primary work IDs.
- Summary-only feeds use the mockable full-text fetch path.
- PLAN-007 Section 9 cross-vector dedup passes for RSS plus Readwise.
- Draft claims persist with text/DOM locators.

## Test Coverage

- `packages/praecis/sources/feeds/tests/rss-source.test.ts`
- `packages/praecis/cli/tests/cross-vector-dedup.test.ts`

## Operational Checklist

- Run a feed item ingest:

  ```bash
  aidha ingest rss --feed https://example.com/feed.xml --item-guid item-1 --json
  ```

- Prefer the article URL as `web:<canonicalUrl>` when present; the feed GUID is a
  provenance/dedup key, not the primary work id.
- Full-text fetches must use mockable IO in CI and no-network fixtures in tests.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/sources/feeds test
  pnpm -C packages/praecis/cli test
  ```
