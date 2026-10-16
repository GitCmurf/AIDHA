---
document_id: AIDHA-RUNBOOK-005
owner: Ingestion Oncall
status: Draft
last_updated: 2026-10-16
version: '0.2'
title: Email Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-005
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-16
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-22 | AI     | Seed email file-import runbook for the PLAN-007 email vector. | — | Draft | — |
| 0.2 | 2026-10-16 | Codex | Update parser dependencies and document malformed-input and MIME regression checks. | — | Draft | PLAN-015 |

## Purpose

Document the `.eml` file-import path, thread reconstruction behavior, and the
operational checks to run after an email batch import.

## Operational Checklist

- **Prepare the input**

  Use a single `.eml` file or a directory of `.eml` messages. The importer
  walks directories recursively and groups messages into threads by message
  references.

- **Run the batch import**

  ```bash
  aidha ingest email --file ./fixtures/email-thread/
  ```

  Add `--json` when the output needs to be consumed by a script or regression
  check.

- **Check the summary**

  The batch summary reports how many files were imported, how many threads were
  reconstructed, and the canonical thread ids. Reply stripping is deterministic,
  so repeated runs over the same fixture should produce the same thread summary.

- **Validate reparenting**

  If a child message arrives before its root, the importer rethreads the
  provisional `email:thread:<inReplyTo>` group onto the later-discovered
  `email:thread:<trueRootMessageId>` identity.

- **Review attachments**

  Attachments are preserved in parsed metadata, but they are not auto-ingested.
  Record any follow-up extraction work explicitly.

## Parser maintenance and validation

Use the committed lockfile. The email package requires Node.js 20.19 or later;
the workspace requires Node.js 22.5 or later. The parser dependency floor is
`mailparser` 3.9.40, whose upstream dependency set includes `nodemailer` 10.1.2
and `linkify-it` 5.0.2. Update the parent package together with its supported
dependency set rather than forcing independent major child versions.

Parsing happens before ingestion privacy gates. Those gates do not limit parser
CPU or memory consumption. The importer reads and parses complete messages;
this update does not establish a general resource limit for arbitrary inputs.

From the repository root, run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @aidha/praecis-source-email lint
pnpm --filter @aidha/praecis-source-email test:ci
pnpm --filter @aidha/praecis-core test:ci
pnpm --filter @aidha/praecis-cli test:ci
pnpm docs:build
```

The resource regression tests invoke the built public `parseEmailFile` entrypoint
in a child process so a synchronous parser stall can be terminated. Rebuild before
running them after source changes. The fifteen-second ceiling distinguishes the
published malformed-address and repeated-mailto regressions from ordinary parsing;
it is a test budget, not a production timeout or performance guarantee.

The synthetic MIME control checks encoded names, recipient order, dates, thread
references, HTML preference, raw text and attachment metadata. The existing pipeline
and CLI suites cover thread persistence, reconstruction and taxonomy assignments.
No private email is needed for these checks.

Acceptance coverage:

- [Resource regression tests](https://github.com/GitCmurf/AIDHA/blob/e7695795956a6111a30a1b958f9e5ef373c456aa/packages/praecis/sources/email/tests/parser-budget.test.ts)
- [MIME compatibility control](https://github.com/GitCmurf/AIDHA/blob/e7695795956a6111a30a1b958f9e5ef373c456aa/packages/praecis/sources/email/tests/mime-compatibility.test.ts)
- Published upstream reports: [address parser](https://github.com/advisories/GHSA-v53p-9fqp-m79j)
  and [mailto matcher](https://github.com/advisories/GHSA-v245-v573-v5vm)
