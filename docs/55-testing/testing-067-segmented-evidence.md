---
document_id: AIDHA-TESTING-067
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
title: Complete Segmented Evidence Recovery
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-010, AIDHA-TESTING-059]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-067
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Complete Segmented Evidence Recovery

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify opt-in complete splitting of exact overlong evidence. | — | Draft | AIDHA-PLAN-010 |

## Scope and acceptance

The default `SourceDistillationMiner` continues to reject an overlong quotation. A caller can
inject `SourceDistillationMiner({ enableSegmentedEvidence: true })` through the existing pipeline
services. This opt-in route tries to split only an original quotation that occurs as an exact,
whole span in its originally cited excerpt and fails solely because it exceeds half that excerpt.
Every resulting passage is a contiguous slice of that original quotation, in the same order. The
passages reconstruct the complete original text apart from whitespace at split boundaries. The
host re-runs the unchanged five-word, four-unique-token, whole-span, literal and half-excerpt
checks for every new passage and requires `exact`. A unit with any failed citation that is not an
exact overlong span, including a fabricated or unsplittable citation, keeps its original
rejection. Already valid citations, including the verifier's `normalized` status, stay unchanged
and in their original order.

The unchanged half-excerpt limit applies to each resulting passage, not to their combined
coverage. In the recorded supplier case, the original 41-token quotation from a 75-token
excerpt becomes two exact passages of 28 and 13 tokens; together they still cover 41 of 75
tokens. This opt-in path therefore changes admission of long literal evidence while retaining
all its text. It makes no aggregate citation-coverage claim, and the split itself does not
establish semantic support; the whole-unit grounding requirement below still applies.

The host prefers existing sentence boundaries and can use existing whitespace boundaries when
needed. It permits at most four passages per failed citation, four failed citations per candidate,
eight attempted failed citations per source and eight repaired candidates per source. It caps each
original quotation at 4096 characters, each cited excerpt at 16000 characters, verification
attempts per quotation at 128 and generated passages per source at 32. These limits can leave an
otherwise valid candidate rejected; they do not relax the evidence verifier.

A provisionally segmented unit enters the existing grounding call with its complete final
evidence. It is admitted only after exactly one explicit `grounded` verdict in a fully valid
verdict batch. Missing, duplicate, malformed, rewrite, ungrounded or transport-failed review
retains the original failed-quotation rejection. The quote-failure ratio is checked again after
grounding, before optional relation review or projection. Unrelated units keep the prior
advisory-grounding behavior. Segmentation adds no model call; generation, an occasional schema
repair, and grounding retain their existing bounds and token accounting. Usage errors fail closed.

`sourceDistillation.segmentRepairs` in the returned run report/cache receipt records the original
failed candidate, selected contiguous passages, full final evidence and final status. A failed
run marks all provisional repairs rejected. SQLite stores the admitted draft claim and exact
evidence after close/reopen, not the full repair audit. The opt-in cache identity is versioned;
the default identity and model route do not change. Host traceability and an advisory model
verdict do not prove semantic entailment or a measured improvement in extraction quality.

[The shared-runtime regression][runtime-test] uses the recorded public supplier `u4` candidate
and its full `alert-3` excerpt. It asserts the exact two-sentence split, one generation plus the
existing grounding call, the original failure audit, and exact qualified claim/evidence after
SQLite close/reopen. Negative cases cover adverse and malformed grounding, final failure ratio,
token failures and mixed fabricated citations. [The splitter test][splitter-test] checks complete
content/order, unchanged valid references, literal gating and work bounds. All tests use public
synthetic text and fake model replies; no model endpoint is invoked.

[runtime-test]: https://github.com/GitCmurf/AIDHA/blob/034-segmented-evidence/packages/praecis/core/tests/pipeline/segmented-evidence.test.ts
[splitter-test]: https://github.com/GitCmurf/AIDHA/blob/034-segmented-evidence/packages/praecis/core/tests/extract/distill/segmented-evidence.test.ts

Run from the repository root:

```sh
pnpm --filter @aidha/praecis-core test -- tests/extract/distill/segmented-evidence.test.ts tests/pipeline/segmented-evidence.test.ts
pnpm --filter @aidha/praecis-core lint
node scripts/meminit-check.mjs docs/55-testing/testing-067-segmented-evidence.md
pnpm docs:build
```
