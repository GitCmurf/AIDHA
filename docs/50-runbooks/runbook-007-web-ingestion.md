---
document_id: AIDHA-RUNBOOK-007
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: Web Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-007
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed web-ingestion runbook for the PLAN-007 web vector. | — | Draft | — |

## Purpose

Run URL ingestion through the shared runtime and verify that fetched pages create
draft claims with DOM/text locators and fetch-independent `web:` identities.

## Acceptance Criteria

- JSON output includes `canonicalId`, `resourceId`, `claimsExtracted`,
  `claimIds`, `dedupAction`, `policyRoute`, `segments`, and `chunks`.
- Primary `web:` identity is derived from fetch-independent `urlCanonical()`;
  redirect targets are dedup keys only.
- Draft claims persist with text/DOM locators.
- PLAN-007 Section 9 cross-vector dedup coverage proves RSS/Readwise overlap
  merges to the shared `web:` identity.

## Test Coverage

- `packages/praecis/acquire/webfetch/tests/webfetch.test.ts`
- `packages/praecis/sources/web/tests/web-source.test.ts`
- `packages/praecis/cli/tests/cross-vector-dedup.test.ts`

## Operational Checklist

- Run a page ingest:

  ```bash
  aidha ingest web --url https://example.com/article --json
  ```

- Confirm the JSON report includes `canonicalId`, `resourceId`, `claimsExtracted`,
  `claimIds`, `dedupAction`, `policyRoute`, `segments`, and `chunks`.
- Redirect handling must keep the input URL canonicalisation as the primary
  `web:` id; resolved URLs and canonical links are dedup keys only.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/acquire/webfetch test
  pnpm -C packages/praecis/sources/web test
  pnpm -C packages/praecis/cli test
  ```
