---
document_id: AIDHA-GUIDE-004
owner: Ingestion Team
status: Draft
version: '0.6'
last_updated: 2026-06-11
title: LLM Claim Extraction Guide
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-004
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-06-11
> **Type:** GUIDE

# LLM Claim Extraction Guide

## Version History

| Version | Date       | Author | Change Summary                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | --------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial LLM extraction guide            | —         | Draft  | —         |
| 0.2     | 2026-02-08 | AI     | Add offline golden fixture workflow and invariant checks | — | Draft | — |
| 0.3     | 2026-02-23 | AI     | Replace placeholder HTTP URLs with non-link tokens for stable linkcheck. | — | Draft | — |
| 0.4     | 2026-06-05 | AI     | Document source synopsis anchors, prompt routing safeguards, and model-ladder defaults. | — | Draft | — |
| 0.5     | 2026-06-11 | AI     | Add source-faithful claim contract, quality metadata, and confidence-gate workflow. | — | Draft | AIDHA-PLAN-009 |
| 0.6     | 2026-06-11 | AI     | Document reviewable/rejected claim split and local evidence refs. | — | Draft | AIDHA-PLAN-009 |

## Purpose

Document LLM-specific extraction controls, cache behavior, and review workflow commands.

## Prerequisites

- Transcript excerpts available (`cli ingest video ...` completed)
- LLM endpoint configured:
  - `AIDHA_LLM_BASE_URL`
  - `AIDHA_LLM_API_KEY`
  - `AIDHA_LLM_MODEL` or `--model`

## Run Extraction

```bash
pnpm -C packages/praecis/youtube cli extract claims <video-url> \
  --llm \
  --model <model> \
  --claims 15 \
  --chunk-minutes 5 \
  --max-chunks 20
```

## Two-Pass Behavior

1. First pass (chunk miner):
   - extracts candidate claims with excerpt IDs
   - validates strict JSON schema
   - retries once on invalid structured output
2. Second pass (editor):
   - removes low-value/short candidates
   - deduplicates by text and excerpt overlap
   - selects stable, diverse final claim set

## Cache Semantics

- Default cache path: `./out/cache/claims`
- Cache metadata keys:
  - transcript hash
  - model
  - prompt version, including prompt-pack cache version
  - chunk index/start/end
- Any mismatch forces recomputation and prevents stale reuse.

## Source Synopsis Contract

Ingestion summaries expose `sourceSynopsis` as a source-level artifact distinct from
raw claims.

- Synopsis bullets should state what the source teaches, not merely report that a speaker said something.
- Each bullet carries a local transcript anchor (`localTranscriptRef`) before any external source URL.
- Category/tool/tag lists should not become bullets unless the transcript asserts a
  workflow, relationship, tradeoff, or recommendation.
- Recommendations should preserve the transcript-supported rationale when present.
- Rejected claim-quality candidates must not be promoted into source synopsis bullets.

## Claim Quality Contract

LLM extraction creates draft candidates, not trusted graph knowledge. Each candidate
should be source-faithful:

- Claim text must be entailed by its cited source excerpts.
- Domain labels must match the source topic and must not import unrelated academic,
  clinical, or neuroscience framing.
- `supportSummary` must name concrete source support.
- Recommendations, warnings, scale limits, and tradeoffs must include `rationale`.
- Reported-speech wrappers, category-soup lists, and weak prose are rejection signals.

The CLI emits these quality fields for each claim:

- `qualityStatus`: `pending | reviewable | accepted | rejected`.
- `qualityReasons`: deterministic rejection or warning reasons.
- `qualityScore`: coarse ordering/diagnostic score.
- `supportCoverage`: lexical support against cited excerpts.
- `trusted`: always `false` for automatic LLM extraction until a stronger verifier or
  human review accepts the claim.

Treat `reviewable` as "safe to review", not "true". Treat `rejected` as diagnostic
evidence for prompt/model improvement, not as graph knowledge.

### Ingestion JSON Shape

Ingestion summaries split automatic extraction output by graph eligibility:

- `claims`: reviewable candidates only. These are the only candidates eligible for
  graph persistence, classification routing, and source synopsis construction.
- `rejectedClaims`: rejected diagnostics retained for prompt/model/debug review.
  These are not graph knowledge and must not be used as accepted source facts.
- `qualitySummary`: `{total, reviewable, rejected}` counts all extracted candidates.

Each claim evidence item carries both:

- `localTranscriptRef`: stable local anchor such as
  `youtube-sboNwYmH3AY#excerpt-id@957-1010`.
- `sourceRef`: external source URL when available, such as a YouTube timestamp.

Prefer `localTranscriptRef` for immediate audit and private pilot review; use
`sourceRef` for source re-opening and citation handoff.

When inspecting JSON with `jq`, do not use `// "missing"` to test boolean fields:
`false // "missing"` returns `"missing"`. Use `has("trusted")` or print
`.trusted` directly.

## Claim-Quality Model Ladder

Use the narrow eval harness to separate model capability from prompt and pipeline faults.

- Routine production candidates: `gpt-5.4-mini`, `gpt-5.4-nano`.
- Cross-provider comparison: `gemini-3.5-flash`.
- Capability-ceiling diagnostic: `gpt-5.5`.
- Oracle-only golden-example generation: `gpt-5.5-pro`; do not run it in routine
  evaluation without deliberate cost approval.

For private pilot comparisons, use cached transcripts and compare the same source
through `gpt-5.4-mini`, `gpt-5.4-nano`, and `gemini-3.5-flash` before changing
the default production candidate. Escalate to `gpt-5.5` only when the routine
ladder cannot distinguish prompt faults from model-capability faults.

## Review and Curation Commands

```bash
pnpm -C packages/praecis/youtube cli review next <video-url> --state draft --limit 10
```

```bash
pnpm -C packages/praecis/youtube cli review apply \
  --claims <claimId1,claimId2> \
  --accept \
  --tag research,backend \
  --task-title "Follow up"
```

## Diagnostics

```bash
pnpm -C packages/praecis/youtube cli diagnose transcript <video-url>
pnpm -C packages/praecis/youtube cli diagnose extract <video-url>
```

`diagnose extract` reports claim state distribution, method counts, and provenance gaps.

## Offline Golden Fixture Mode

Use deterministic transcript fixtures for CI and local regression checks.

Fixtures live in:

- `testdata/youtube_golden/IN6w6GnN-Ic.excerpts.json`
- `testdata/youtube_golden/UepWRYgBpv0.excerpts.json`

Run fixture-only tests (no network, no model calls):

```bash
pnpm -C packages/praecis/youtube test -- tests/golden-fixtures.test.ts
```

Refresh fixtures (manual capture + normalize):

```bash
bash packages/praecis/youtube/ops/capture-golden-fixtures.sh
```
