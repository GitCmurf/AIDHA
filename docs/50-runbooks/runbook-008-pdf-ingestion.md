---
document_id: AIDHA-RUNBOOK-008
owner: Ingestion Oncall
status: Draft
last_updated: 2026-05-22
version: '0.1'
title: PDF Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-008
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-22
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed PDF-ingestion runbook for the PLAN-007 PDF vector. | — | Draft | — |

## Purpose

Run local PDF/document ingestion through text extraction, OCR fallback seams, and
the shared runtime.

## Acceptance Criteria

- `pdf:` canonical identity is SHA-256 content-hash based.
- Page locators include stable page and character offsets.
- OCR fallback remains mockable for scanned-page paths.
- Draft claims persist through the shared runtime.
- Sensitive documents follow the configured privacy route.

## Test Coverage

- `packages/praecis/sources/pdf/tests/pdf-source.test.ts`
- `packages/praecis/decode/text/tests/text-extract.test.ts`
- `packages/praecis/decode/ocr/tests/ocr.test.ts`
- `packages/praecis/core/tests/pipeline/sensitivity-gate.test.ts`

## Operational Checklist

- Run a local file ingest:

  ```bash
  aidha ingest pdf --file ./fixtures/sample.pdf --json
  ```

- Confirm the `pdf:` canonical id is content-hash based and page locators are
  present on excerpts.
- Keep sensitive local documents off cloud routes unless policy explicitly allows
  that tier.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/decode/text test
  pnpm -C packages/praecis/decode/ocr test
  pnpm -C packages/praecis/sources/pdf test
  ```
