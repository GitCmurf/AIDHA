---
document_id: AIDHA-RUNBOOK-008
owner: Ingestion Oncall
status: Draft
last_updated: 2026-06-01
version: '0.2'
title: PDF Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-008
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-06-01
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed PDF-ingestion runbook for the PLAN-007 PDF vector. | — | Draft | — |
| 0.2     | 2026-06-01 | AI     | Add the generic activation handoff after PDF ingestion. | — | Draft | AIDHA-TASK-010 |

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
- Hand the captured claims to the generic activation loop:

  ```bash
  aidha query "project re-entry" --include-drafts --json
  aidha task create --from-claim <claim-id> --title "Follow up" --project <project-id> --json
  aidha task show <task-id> --json
  aidha project reentry --project <project-id> --markdown --out out/project-reentry.md
  aidha export graph --jsonld --out out/graph.jsonld
  ```

  The task output should preserve Claim -> Excerpt -> Resource provenance before
  the claim is used as pilot evidence.
- Validate locally with:

  ```bash
  pnpm -C packages/praecis/decode/text test
  pnpm -C packages/praecis/decode/ocr test
  pnpm -C packages/praecis/sources/pdf test
  ```
