---
document_id: AIDHA-TESTING-067
owner: Engineering
status: Draft
version: '0.4'
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
> **Version:** 0.4
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Complete Segmented Evidence Recovery

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify opt-in complete splitting of exact overlong evidence. | — | Draft | AIDHA-PLAN-010 |
| 0.2 | 2026-10-17 | Codex | Pin reviewed regression links and record the bounded recovery replay and review limits. | — | Draft | AIDHA-PLAN-015 |
| 0.3 | 2026-10-17 | Codex | Separate grounding admission and verify saved-response request, audit and SQLite parity. | — | Draft | AIDHA-PLAN-015 |
| 0.4 | 2026-10-17 | Codex | Pin the reviewed pure admission and threshold-boundary tests. | — | Draft | PR 44 |

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
tokens, counted as letter/number sequences by the quote verifier, not model billing tokens.
This opt-in path therefore changes admission of long literal evidence while retaining
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

[runtime-test]: https://github.com/GitCmurf/AIDHA/blob/83ab40323d86e9c2154573bbf50d95f39a3cc1f6/packages/praecis/core/tests/pipeline/segmented-evidence.test.ts
[splitter-test]: https://github.com/GitCmurf/AIDHA/blob/83ab40323d86e9c2154573bbf50d95f39a3cc1f6/packages/praecis/core/tests/extract/distill/segmented-evidence.test.ts

Run from the repository root:

```sh
pnpm --filter @aidha/praecis-core test -- tests/extract/distill/grounding-admission.test.ts tests/extract/distill/segmented-evidence.test.ts tests/pipeline/segmented-evidence.test.ts
pnpm --filter @aidha/praecis-core lint
node scripts/meminit-check.mjs docs/55-testing/testing-067-segmented-evidence.md
pnpm docs:build
```

## Controlled public supplier replay

A manual replay at clean runtime revision `74134ecf49ea8dd9582d50122967aa6c3ea072ba` reuses
the first Gemini writer trial's complete generated supplier response and original three excerpts.
It makes one fresh native AGY `gemini-3.8-flash-low` grounding call, using client revision
`61ddd7139f015d020b2426bf215a05f2e9b97089`. The model explicitly returns `grounded` for `u4`.
The shared ingestion runtime writes four claims, closes SQLite and reopens it. The previously
missing conditional recommendation is the only added claim; all three prior claims retain
identical IDs, type, label, content and metadata. The recovered recommendation remains an
untrusted draft, with both original conditions, operations-lead attribution and the two exact
`alert-3` passages. Original failed evidence and the grounded repair appear in the saved report.

The fresh call reports 15088 input tokens, 65 output tokens, 15153 total tokens and a native
duration of 5.42558754 seconds. The pipeline token total is 31448 because it also accounts for
16295 tokens from the reused generation; those reused tokens are not another live call. Provider
API cost is unknown (`null`); the runtime's internal zero spend is not a provider cost measurement.

The first private runner preflight fails before a model call because a provenance hash read uses
a URL string as a path. After that correction, the actual run completes, but its final assertion
initially reads draft state from the wrong location (`claim.state`). The saved SQLite node holds
`metadata.state = draft`. Correcting only that offline assertion makes the full recovery gate
pass against the unchanged saved report; seven adverse mutations fail. Both original failed
receipts are retained. No second fresh grounding call is made.

[The public measurement projection][measurement] contains the source, frozen generation, fresh
verdicts, repair audit, unchanged baseline claims and SQLite-reopened claims. It excludes raw
native account metadata, conversation identifiers and stderr. Two assistant reviews check the
code path; an independent assistant comparison checks this run's factual recovery. These are not
human gold labels or semantic endorsement.

This establishes feasibility for one public fictional source. It does not establish repeated
quality gain, writer superiority, corpus prevalence or a Pareto frontier. The baseline uses
InMemoryStore and this replay uses SQLite, so the result is a controlled pipeline check rather
than an isolated model experiment. A fresh model judge can still be wrong. Owner review of the
semantic expectations and per-citation admission policy is needed before default adoption.
The earlier supplier-origin and trial-burden qualification issues remain unchanged.

[measurement]: https://github.com/GitCmurf/AIDHA/blob/21c716a356fee084f8de72e53673b37d70eefed9/scripts/semantic-quality/segmented-evidence-measurement.json

## Grounding admission boundary and offline parity

The pure `grounding-admission.ts` transition owns verdict application, strict repaired-unit
admission, repair status and the final failure ratio. The miner retains model calls, token
accounting and optional limitation orchestration. This extraction preserves the existing
prompt, evidence policy, ordinary advisory behavior, cache identity and failure handling.
[The pure tests][admission-test] protect unique valid grounding,
missing/duplicate/rewrite/ungrounded verdicts,
malformed batches, advisory transport failure, original rejection restoration and the exact
half-failure boundary. A distinct residual failed candidate counts separately from a rejected
repair; successfully repaired candidates are excluded from the residual failed-unit set.

An offline shared-runtime replay builds the dependencies and supplies exactly the two saved
replies from the controlled run above, without a provider call. Its grounding request matches
the saved live request exactly, including system and user strings. All four SQLite-reopened
claims match by ID, type, label, content and complete metadata. The complete serialized
source-distillation audit and supporting units also match. Six adverse mutations to claim text,
a condition, audit status, prompt, claim count and support relations fail the corresponding
comparison. This is parity for one saved execution, not another semantic-quality measurement.

The first offline attempt stops at a sandbox process restriction before building or executing
the runtime. The permitted execution completes, but its original in-memory comparison fails on
explicit `undefined` properties that the JSON baseline omits. The original failed result is
preserved. A separate pure comparison reads only the saved input/output JSON and passes;
its initial report-identity assertion is also corrected against those saved records. Neither
correction re-executes the runtime or calls a model. The passing comparison establishes JSON
representation and persisted-state parity; a JSON-only baseline cannot establish whether the
original in-memory object had an omitted property or one whose value was `undefined`.

The replay binds the implementation to these SHA-256 source hashes:

```text
miner.ts
  ef0d83587a58e0524b0640724ecf4309c4222b477510d0a8267aa79d8e54dbe5
grounding-admission.ts
  3b48da6198e526c5fc4cd8113671d841826af7ec70d641632cb5b617d11621b1
```

The published live measurement remains pinned to its original runtime and measurement commits.
This refactor and offline check do not relabel it as a fresh model run, establish entailment,
or approve the opt-in policy as a production default.

[admission-test]: https://github.com/GitCmurf/AIDHA/blob/3a59b7547561204e9f9b0be828841a08968fb66c/packages/praecis/core/tests/extract/distill/grounding-admission.test.ts
