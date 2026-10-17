---
document_id: AIDHA-TESTING-057
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
title: Bounded Model Distillation and Grounding
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-056]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-057
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Bounded Model Distillation and Grounding

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify the injectable generation and grounding miner, public report boundaries and retry/cache controls. | — | Draft | AIDHA-PLAN-015 |

## Scope

`SourceDistillationMiner` implements the existing core `ICandidateMiner` interface. A configured
LLM generates source-level knowledge units and reviews their meaning against source excerpts.
Host code validates structure and literal evidence, applies verdicts and projects untrusted drafts.
The existing default extractor remains selected. There is no new CLI flag or provider integration.

This bounded extraction excludes consolidation, quotation reselection, large-source section notes,
source-note persistence, activation and reader UI. The broader PLAN-010 remains outside this PR.
Tests use synthetic sources and recording clients, with no live provider calls. They establish host
handling of model output; they do not establish model accuracy or useful semantic extraction.

## Generation and evidence contract

- Requests require an injected LLM, a configured model, at least one chunk, and unique nonblank
  excerpt IDs. Invalid requests return an error before a provider call.
- The generation prompt supplies complete excerpts as JSON data, preserving original Unicode,
  backticks, quotation marks and source instructions under analysis. Labels use the existing
  sanitisation helper. Encoding source text does not certify resistance to prompt injection.
- Generation uses the provider-facing schema from TESTING-056. Host parsing/reference validation
  remains authoritative. Invalid structure gets one repair call; another invalid response or
  generation transport failure returns empty output with `distillation.failedClosed: true` and
  diagnostics. A failed extraction must not become a successful cached zero-claim result.
- Literal checks use TESTING-056 unchanged. A unit with any failed reference cannot enter grounding
  or reusable output. Above `quoteFailureCloseThreshold` (default 0.3, strict `>`), the entire
  extraction fails closed. Otherwise failed units are archived in `rejectedClaims`.
- An empty valid proposal is allowed and makes no grounding call. There is no forced claim count.

## Semantic grounding contract

Grounding is another LLM judgment. Its prompt carries cited excerpts plus the other supplied
excerpts as source context. Context helps check roles and later corrections; it does not replace
or change a unit's citations.

An explicit `ungrounded` verdict archives the unit. A `rewrite` can change text, rationale,
conditions, attribution, stance or importance. Omitted fields stay unchanged; null rationale or
attribution removes that field. Rewrites must pass the knowledge-unit schema, including the
requirement that limitations retain a rationale or condition. The original verified evidence
remains immutable. Parsed schema normalisation also applies to rewritten fields.

Ordinary grounding transport failures, malformed responses or missing unit verdicts retain the
literal-verified units with diagnostics. Unknown verdict IDs are ignored; duplicate verdicts keep
the first and add a diagnostic. Verdict entries are validated independently: one malformed entry
cannot erase a valid explicit rejection of another unit. Per-entry errors are bounded diagnostics;
only that entry follows the missing-verdict policy. These are advisory decisions: all emitted claims
remain untrusted
reviewable drafts, including when a model returns `grounded`. Human review and separately
adjudicated semantic evaluation remain necessary to demonstrate accuracy and usefulness.

## Projection and public output

Projection follows TESTING-056. Draft claims retain source qualifications, attribution, literal
references, model/prompt provenance and `trusted: false`. Supporting examples/procedures stay in
`supportingUnits`; rejected units retain their original meaning, evidence and rejection reason.
Source labels, diagnostic citation metrics and unit counts accompany the result.

Live `supportsUnitIds` target only units actually emitted as claims or supporting context.
Source-proposed links to rejected or diagnostic units move to `unresolvedSupportsUnitIds` and
receive a diagnostic. They are not silently presented as live relationships. Rejected archives
retain their original proposed links.

The production `ConfiguredIngestionRuntime.runVector` accepts the injected miner, exports retained
claims through the graph exporter, and returns supporting/rejected/distillation reports.
Distillation draft IDs include source meaning and evidence: same text with distinct qualifications
or citations remains distinct. Model/prompt versions and generated unit numbering do not create
new identity by themselves. Legacy draft IDs retain their existing rule.
The shared CLI ingestion summary mapper retains these reports, failure status and optional claim
metadata. Source notes and supporting/rejection reports are not newly persisted on Resource nodes.
Consumers needing those reports must retain the returned summary.

## Cache and usage controls

Cache identity includes source chunks/locators, source label/context, model endpoint and controls,
extraction/editor configuration, privacy route and the miner's explicit identity. The new miner
identity includes its prompt versions and options. Built-in legacy miners have explicit identities;
custom miners without a nonblank identity bypass cache. Callers must change custom identities when
output-affecting behavior changes. Old cache entries naturally miss the new key.

A successful cache hit after a fresh runtime retains the full mining report. Failed-closed results
are neither reused nor written to cache. This does not make cache parsing a hostile-data validator.

Each model request caps completion output at 16,000 tokens, reduced when a total-token allowance is
configured. Before a call, the miner reserves estimated prompt/schema input tokens from the
remaining allowance. It stops before another call when the allowance is exhausted, after reported
usage exceeds it, or before a later call when required usage is unavailable. A final grounding
response with missing usage retains the ordinary advisory behavior and reports the accounting gap.
Estimates use the existing
heuristic; provider tokenisation and framing can differ. This is a preflight and reported-usage
control, not a hard provider billing cap. Provider-side limits are required for that guarantee.

`tokenUsage` sums reported usage across completed generation, repair and grounding calls. A later
throw cannot erase earlier usage. Missing usage is disclosed in diagnostics; the sum then covers
reported calls only. No dollar estimate is invented. Because the client reports tokens without
pricing, a configured `maxSpendUsd` returns an error before any call. No additional service or
account activation is required for the synthetic tests.

## Usage and recovery

Inject the miner through the existing services boundary; supply an already authorised LLM client,
configuration, store, source vector and input. This does not select it for unrelated ingestion.

```typescript
import {
  SourceDistillationMiner,
  createIngestionRuntimeFromServices,
} from '@aidha/praecis-core';

const runtime = createIngestionRuntimeFromServices({
  ...services,
  miner: new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' }),
});
const result = await runtime.runVector(vector, input);
```

Inspect `sourceDistillation.failedClosed`, its diagnostics, rejected units and source-linked
qualifications before reusing output. Correct configuration/provider failures and rerun; failed
runs do not poison the cache. A successful model-grounding label is not an approval. Close resources
according to the existing runtime ownership contract.

## Acceptance evidence

- Core `tests/extract/distill/miner.test.ts`: generation/repair, quoted evidence gate, advisory
  grounding, invalid requests, reported usage and token preflight.
- Core `tests/extract/distill/grounding.test.ts`: rewrites, null-clears, immutable evidence,
  invalid limitation rewrites and unknown/duplicate/missing verdict handling.
- Core `tests/extract/distill/prompts.test.ts`: complete original source data and supplemental
  context survive prompt encoding.
- Core `tests/extract/distill/report.test.ts`: qualified untrusted drafts, supporting/rejected
  outputs, routing and unresolved proposed links.
- Core `tests/pipeline/distillation.test.ts`: real runtime/exporter output, cache isolation,
  fresh-runtime cache hits and retry after failure.
- CLI `tests/distillation.test.ts`: public source ingestion retains failure and qualified reports.

Run the owning package tests and lint/build, the full workspace build, strict documentation build,
scoped DocOps and public/secret checks. Review the complete diff before commit, inspect actual bot
reports after push, and obtain separate owner approval before merging this new slice.
