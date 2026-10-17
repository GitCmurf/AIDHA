---
document_id: AIDHA-TESTING-056
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
title: Validation and Evidence Checks for Model-Generated Distillations
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-056
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Validation and Evidence Checks for Model-Generated Distillations

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify the isolated validation, quotation, citation-diagnostic and routing contracts. | — | Draft | AIDHA-PLAN-015 |

## Scope and limits

Semantic distillation requires a model to interpret the source, identify important ideas and
express qualified propositions. This slice provides deterministic validation around a proposed
distillation. Given the same proposal and source excerpts, the checks return the same results.

Passing these checks establishes structural validity and defined literal-match eligibility.
It does not establish that a quotation entails its claim, that model-assigned labels or
attributions are correct, or that important ideas have been extracted. A copied quotation can
accompany a contradictory claim. Citation metrics and routing decisions cannot resolve that.

The broader source-level pipeline is proposed in AIDHA-PLAN-010, retained outside this PR.
Model generation, semantic grounding, consolidation, source notes, persistence, caching and
default ingestion wiring need later reviewed slices and semantic evaluation. This slice makes
no provider calls and introduces no runtime pipeline or storage change.

## Contract

### Structure and references

`parseSourceDistillation` accepts schema version 1 with unique unit IDs, known excerpt references
and known unit references. Every unit needs evidence. A limitation needs a rationale or condition;
a recommendation may omit a rationale rather than invent one. Unknown attribution cannot assert
a name or role. Null optional wire fields become absent local fields. Empty units and theses
are permitted; there is no forced claim count. Errors are bounded and readable.

`distillationResponseSchema` describes provider-facing structured output with required nullable
optional fields and allowed excerpt IDs. Host validation remains authoritative. A generation
schema requires at least one allowed excerpt; a caller with no excerpts must avoid generation.

### Literal quotation eligibility

`verifyQuote` returns `exact`, `normalized` or `failed`. Normalisation applies NFKC, lowercasing,
curly-quote substitutions and collapsed whitespace. Matches require whole spans, including the
defined word/number boundaries. Approximate token overlap cannot establish a literal quotation.

The extracted eligibility policy requires at least five words, four distinct tokens, and at most
half the excerpt's token count. Consequently, some literal quotations fail eligibility. These
thresholds are mechanical policy, not evidence that the proposition is true or important.
Changing them requires explicit tests and review, not a claim of semantic verification.

`verifyDistillationEvidence` retains annotations and reports failed unit IDs. Any failed reference
fails its unit, even alongside a valid quotation. The function does not silently drop units.
The legacy `fuzzy` status remains readable in types; new verification never awards it and citation
diagnostics do not count it as verified evidence.

### Citation diagnostics

`computeCoverage` counts only exact/normalised references to supplied excerpts. Repeated citations
count each excerpt once. Unknown references and failed/fuzzy matches count as weak evidence.

`excerptsCitedPercent` is the fraction of supplied excerpts with an eligible citation.
`citedTextPercent` is the fraction of excerpt text belonging to those cited excerpts, measured in
JavaScript string code units. It credits the whole cited excerpt, not just the quoted characters.
Even 100% does not establish complete quotation, semantic coverage, recall or useful extraction.

`largestUncitedGapSeconds` is the longest continuous interval covered by uncited timecoded excerpts
after subtracting cited excerpt intervals. Overlaps and input ordering cannot change its result;
unrepresented time gaps do not join separate intervals. Non-timecoded or invalid time intervals
do not contribute to the temporal measure, but their text/citations still contribute to counts.

These measures are diagnostics with no pass threshold or forced claim floor. They do not reject
the source or automatically request more claims. Duplicate excerpt IDs raise a `RangeError`.

### Routing policy

`projectUnit` routes already validated model labels using application intent. The route is a
suggestion for a later consumer; returning `claim` does not accept, verify or persist a claim.
Source type is accepted for interface consistency and currently does not alter the policy.

| Importance / kind | Knowledge graph | Source summary | Runbook |
| --- | --- | --- | --- |
| Incidental, any kind | diagnostic | diagnostic | diagnostic |
| Core/supporting example | supportingEvidence | supportingEvidence | supportingEvidence |
| Core/supporting procedure | procedure | procedure | claim |
| Other core/supporting kinds | claim | claim | claim |

## Acceptance and verification

The core package exports the contract entrypoints so later consumers can use them without
private source paths. Tests exercise each module and compose the exported package boundary.
Fixtures are synthetic and inline. No private transcript or live model result is required.

| Test file under `packages/praecis/core/tests/extract/distill/` | Acceptance |
| --- | --- |
| `schema.test.ts` | Schema version, IDs/references, optional/nullable fields, bounded errors and generation schema |
| `quote-verification.test.ts` | Literal normalisation, word/number boundaries, fabricated references and mixed evidence |
| `coverage.test.ts` | Known citation counts, weak evidence, order/overlap/gap handling and empty inputs |
| `projection.test.ts` | Exact routing table over all intent, source type, kind and importance combinations |
| `boundary.test.ts` | Exported composition and explicit demonstration that mechanical acceptance is not entailment |

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build:deps
pnpm --filter @aidha/praecis-core build
pnpm --filter @aidha/praecis-core lint
pnpm --filter @aidha/praecis-core test:ci
pnpm docs:build
pnpm docs:linkcheck
node scripts/meminit-check.mjs docs/55-testing/testing-056-distillation-validation.md
```

Check the built package entrypoint as well as source tests. Required CI, independent code review
and actual reporting-bot findings remain merge gates under the
[branch landing workflow](../05-planning/plan-015-branch-landing-workflow.md).
