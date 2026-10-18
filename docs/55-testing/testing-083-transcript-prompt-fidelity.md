---
document_id: AIDHA-TESTING-083
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-10-18
title: Complete Transcript Data in Chunk Mining Prompts
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-083
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Complete Transcript Data in Chunk Mining Prompts

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify complete chunk data and bounded input estimates. | — | Draft | AIDHA-PLAN-015 |
| 0.2 | 2026-10-18 | Codex | Correct qualified pack cache identities. | — | Draft | PR 52 |
| 0.3 | 2026-10-18 | Codex | Align diagnostic pack inference and provenance. | — | Draft | PR 52 |

## Contract

Both existing chunk-mining prompt builders carry complete excerpt text after the existing
upstream normalization and chunking. They do not cap each excerpt at 1,000 characters, redact
instruction-like source phrases, normalize Unicode or replace source fence characters.
The shared encoder serializes excerpt IDs, timestamps, text and optional speaker as JSON inside
an explicitly untrusted data section. JSON escaping keeps embedded quotes and newlines in string
values; source triple quotes cannot close that section structurally. This does not establish
that a model will resist arbitrary prompt injection. Labels and control fields retain their
existing sanitization. Model defaults, extraction selection, ranking and style remain unchanged.

This contract covers the configured canonical chunk miner, including its legacy generic builder
and Pass1 v2 builder selected by prompt version or a non-generic routed pack. It does not complete
all source-distillation stress or section-note requirements in AIDHA-TESTING-010, nor claim a
measured semantic-quality gain.

## Estimated input budget

Keeping complete text does not increase configured input allowances. Existing splitting between
excerpts remains. Before the first chunk generation call, every resulting chunk must fit the
configured hard input-token estimate. An intact single excerpt that cannot fit fails with
`ClaimRequestBudgetError`; text is not silently shortened. A chunk exceeding only the target
size may retain the existing warning and proceed when it fits the hard limit.

The estimate uses the existing `estimateTokens(system) + estimateTokens(user)` calculation.
It is not exact provider tokenization, billing, spend or an output/context reservation guarantee.
Each actual chunk request, including parse-feedback retries, is checked again. A feedback retry
that exceeds the hard limit fails before that retry call; its initial call has already occurred.
Transport retries keep the same checked request. The failure propagates past heuristic fallback
and returns a failed Result through the configured canonical miner. Separate editor and
self-improvement request limits are unchanged.

Initial oversize rejection occurs before chunk-cache entry writes or graph export. Ingestion
adapters may already have their own acquisition effects; this contract does not promise no graph
writes across every possible ingestor. The tested adapter has no acquisition writes and verifies
that prior graph contents survive without new claims, export or checkpoint changes.

## Cache identity

The transcript encoding revision is included in effective prompt identities for every affected
pack, the canonical miner's outer pipeline cache identity and the evaluation matrix's resume
extraction identity. Historical current-format and legacy-fallback entries cannot satisfy the
corrected default identity. Exact corrected requests
still reuse their cache. The public cache diagnostic loader uses the same effective identity;
fully qualified historical versions are also upgraded to the current encoding identity, while
already corrected versions remain unchanged. Matrix result and cached-cell metadata expose the
actual extractor/encoding revision without changing the prompt-family selector.

An explicitly selected runtime pack takes priority over an embedded pack in a qualified version,
including bounded escalation from enumeration-framework to enumeration-framework-v2. A diagnostic
caller omitting a pack retains the embedded pack; an unqualified version defaults to generic.
The current generic and encoder revisions are rebuilt once, preserving family/custom revisions.
Diagnostic candidate provenance reports the effective version actually used for its cache read.
The exported YouTube `diagnoseExtraction` reader recognizes that pack before current cache/custom
revision suffixes in canonical single-pack versions. It infers omitted packs from Resource or
Claim metadata written by extraction, honors explicit pack options, and normalizes both loaded
and reported identities through the shared helper. Historical nested-pack qualification is not
a supported cache-reuse format; generation now writes canonical single-pack identities.

The shared cache contract advances to `full-transcript-json-v2` for this correction. The payload
JSON encoding is unchanged. Published v1 outer-runtime and evaluation-matrix results may contain
outputs from a suppressed stronger-pack retry, so those entries are invalidated too. The pure
generic prompt revision constant is declared before its helper; its value and behavior are unchanged.

## Acceptance

`packages/praecis/core/tests/pipeline/transcript-prompt-fidelity.test.ts` checks:

- Actual configured runtime requests through both builders retain instruction-like source words,
  Unicode and a qualification beyond character 2,000, subject to existing whitespace normalization.
- JSON round trips raw adversarial headers, quotes, fences and newlines in the direct Pass1 builder.
  Source text stays outside the system message; original exported graph excerpt text is unchanged.
- Each of six packs rejects separately seeded old current-format and legacy-fallback entries.
  Qualified historical and raw diagnostic reads miss old entries and find corrected entries
  without duplicating the revision, including when the diagnostic omits the pack. Both pre-fidelity
  and published v1 encoding identities are exercised. Fresh extractors reuse the corrected entry.
- A configured runtime ignores a valid old outer pipeline entry, calls the recording fake LLM,
  and reuses its new outer entry on an exact retry. Both original and published v1 outer identities
  have positive old-cache hits before the corrected runtime ignores them.
- A real weaker-pack pass triggers existing stronger-pack escalation, makes a second provider call
  with the stronger prompt, returns its improved structural result, and caches both packs separately.

`packages/praecis/core/tests/pipeline/transcript-prompt-budget.test.ts` checks:

- A later oversized chunk prevents all initial provider calls and chunk-cache entry writes.
- Configured runtime rejection preserves prior graph output and returns a typed error.
- Parse-feedback overflow makes one initial call and no retry call, cache entry or fallback output.
- Target-only oversize retains full text, and existing multi-excerpt splitting keeps all intact
  source payloads within the hard estimate.

`packages/praecis/youtube/tests/eval/matrix-prompt-fidelity.test.ts` seeds a valid historical
matrix extraction on disk, proves it is readable under its historical identity, and runs the
real evaluation runner with a recording fake provider. The runner regenerates rather than
resuming old claims, then resumes its corrected entry without constructing another client.
Both original and published v1 matrix identities are tested with default, custom and qualified
prompt-version labels. Judge/model selection and score cache identities are unchanged.

`packages/praecis/youtube/tests/diagnose.test.ts` runs real extraction/store/cache fixtures,
then proves diagnostic cache hits from either Resource or Claim metadata with current non-generic
revisions. It also checks explicit pack override, normalized reported provenance and unchanged
provider-call counts. Existing raw-v1 diagnostic tests remain in scope. This reader correction
does not change generation output or advance the shared v2 cache revision.

All provider interactions use recording fakes; no live service or paid model is needed.

```sh
pnpm --filter @aidha/praecis-core exec vitest run \
  tests/pipeline/transcript-prompt-fidelity.test.ts tests/pipeline/transcript-prompt-budget.test.ts
pnpm --filter @aidha/praecis-core lint
pnpm docs:build
```
