---
document_id: AIDHA-GUIDE-004
owner: Ingestion Team
status: Draft
version: '0.7'
last_updated: 2026-06-13
title: LLM Claim Extraction Guide
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-004
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.7
> **Last Updated:** 2026-06-13
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
| 0.7     | 2026-06-13 | AI     | Rewrite for source-level distillation pipeline (AIDHA-PLAN-010); document passes, schema, fail-closed policy, CLI flags, and RunReport additions. | — | Draft | AIDHA-PLAN-010 |

## Purpose

Document the source-level distillation pipeline that is the default extraction path as of AIDHA-TASK-012,
including pipeline passes, the knowledge-unit schema, the fail-closed policy, CLI flags, and the
`RunReport` additions. See AIDHA-PLAN-010 for the full design rationale and AIDHA-TASK-012 for the
implementation plan.

## Prerequisites

- Transcript excerpts available (`aidha ingest youtube ...` completed)
- LLM endpoint configured:
  - `AIDHA_LLM_BASE_URL`
  - `AIDHA_LLM_API_KEY`
  - `AIDHA_LLM_MODEL` or `--model`

## Pipeline Overview

The distillation pipeline replaces the previous chunk-mining approach with a single whole-source pass
that produces typed knowledge units, verified against verbatim quotes, then projected deterministically
to graph claims.

### Pass 0: Section Notes (optional, triggered when source exceeds ~30k tokens)

When the concatenated transcript text is long, the pipeline first makes a lightweight pass over
overlapping excerpt windows to collect per-section observations. These section notes are folded
into the main distillation prompt to give the model a structured outline of the source before the
single whole-source call.

### Pass 1: Source Distillation (one repair retry)

A single LLM call receives all transcript excerpts and produces a `SourceDistillation` JSON object
(see schema below). If the response fails schema validation or integrity checks, the pipeline makes
one repair call with the validation errors appended as a re-prompt. If the repair also fails, the
run fails closed (see Fail-Closed Policy).

### Deterministic Quote Verification

After Pass 1, every evidence quote is verified against its cited excerpt text using a three-tier
policy:

- **exact**: verbatim substring match.
- **normalized**: matches after punctuation/case/whitespace normalization.
- **fuzzy**: most quote tokens appear within a sliding window over the excerpt tokens.
- **failed**: none of the above.

A unit whose every quote is `failed` is removed. If more than 30% of units fail quote verification,
the run fails closed (see Fail-Closed Policy).

### Pass 2a: Grounding (advisory)

An optional LLM judge reviews verified units against their cited excerpts and returns one of three
verdicts per unit:

- **grounded**: keep as-is.
- **rewrite**: apply the judge's corrected text and/or recovered rationale.
- **ungrounded**: move to `rejectedClaims`.

A unit with no verdict from the judge is kept (quote verification already passed). The grounding
pass is advisory: it does not override the hard quote-verification gate.

### Pass 2b: Consolidation (advisory)

An optional LLM call identifies relations between units (see Relation Types below) and returns
a structured relation list. The pipeline applies these relations deterministically:

- **merged\_duplicate**: evidence union from source into target; source unit removed.
- **supports / example\_of**: `supportsUnitIds` wired from source to target.
- **limits**: source unit's conditions folded into target unit's conditions list.
- **refines / contrasts**: recorded in `sourceDistillation.relations` without modifying units.

### Deterministic Graph Projection

After grounding and consolidation, each surviving unit is projected to a graph role by a pure
function (no model involvement):

| `--extraction-intent` | Unit kind       | Unit importance | Projection        |
| --------------------- | --------------- | --------------- | ----------------- |
| `knowledge_graph`     | idea/mechanism/fact/recommendation/limitation | core or supporting | `claim` |
| `knowledge_graph`     | example         | any             | `supportingEvidence` |
| `knowledge_graph`     | procedure       | core or supporting | `procedure`    |
| `runbook`             | procedure       | core or supporting | `claim`        |
| any                   | any             | incidental      | `diagnostic`      |

Units projected to `claim` appear in `RunReport.claims` (and `IngestSummary.claims`).
Units projected to `supportingEvidence` or `procedure` appear in `RunReport.supportingUnits`
(and `IngestSummary.supportingUnits`). Units projected to `diagnostic` are dropped silently.

### Coverage Diagnostics

After projection, the pipeline computes coverage statistics over the excerpt set:

- Excerpt citation rate (count and percent).
- Cited text percent (by character count).
- Largest contiguous uncited time gap (seconds).
- Core units lacking any verified evidence.
- Total weak (failed) quote count.

These appear in `RunReport.sourceDistillation.coverage`.

## Knowledge-Unit Schema

Each unit in the `SourceDistillation` object carries:

| Field            | Type                  | Required                    | Description |
| ---------------- | --------------------- | --------------------------- | ----------- |
| `id`             | string                | yes                         | Unique within the response. |
| `kind`           | enum                  | yes                         | `idea`, `mechanism`, `fact`, `recommendation`, `limitation`, `example`, `procedure`. |
| `text`           | string (≥ 20 chars)   | yes                         | Canonical standalone statement. |
| `stance`         | enum                  | default: `asserted`         | `asserted`, `recommended`, `demonstrated`, `reported`, `speculative`, `contested`. |
| `attribution`    | object                | no                          | `{kind, name?}` where kind is `speaker`, `named_third_party`, `study`, or `tool_output`. |
| `conditions`     | array                 | no                          | `{type, text}` where type is `temporal`, `scale`, `audience`, `assumption`, or `exclusion`. |
| `rationale`      | string                | required for `recommendation` | Why the unit holds or is recommended. |
| `evidence`       | array (≥ 1 item)      | yes                         | `{excerptId, quote}` — verbatim quote from the cited excerpt. |
| `supportsUnitIds`| string[]              | no                          | Other unit IDs this unit supports or illustrates. |
| `importance`     | enum                  | yes                         | `core`, `supporting`, `incidental`. |

Integrity rules enforced at parse time:

- `recommendation` units must carry `rationale`.
- `limitation` units must carry at least `rationale` or one `conditions` entry.
- All `evidence.excerptId` values must match known transcript excerpt IDs.
- All `supportsUnitIds` must reference other unit IDs in the same response.
- Duplicate unit IDs are rejected.

## Fail-Closed Policy

The pipeline fails closed when it cannot produce reliably grounded output:

1. **Parse repair exhausted**: both the initial distillation call and the repair retry return
   responses that fail schema validation or integrity checks.
2. **Quote verification failure rate > 30%**: more than 30% of units fail quote verification
   after Pass 1.

When failing closed:

- Zero claims are persisted (`RunReport.claims` is empty).
- `RunReport.sourceDistillation.failedClosed` is `true`.
- `RunReport.sourceDistillation.diagnostics` contains the failure reasons.
- A warning is emitted to stderr: `warning: extraction failed closed; no claims persisted. See sourceDistillation.diagnostics.`

Use `--allow-partial` to bypass the fail-closed gate and persist whatever units passed quote
verification even when the failure rate exceeds 30%.

## CLI Flags

```bash
aidha ingest youtube --url <url> \
  [--extraction-intent <knowledge_graph|runbook|source_summary>] \
  [--allow-partial] \
  [--json]
```

- `--extraction-intent <intent>`: controls graph projection (see table above). Default is
  `knowledge_graph`. `runbook` promotes procedures to claims. `source_summary` currently
  projects identically to `knowledge_graph` (behavior reserved for future use).
- `--allow-partial`: bypass the fail-closed gate; persist units that passed quote verification
  even if the overall failure rate exceeds 30%.
- `--json`: print the full `IngestSummary` as JSON to stdout.

## Temporary Extraction Path Toggle

A temporary environment variable allows falling back to the legacy chunk-mining path during the
r9 comparison checkpoint:

```bash
AIDHA_EXTRACTION_PATH=chunk-mining aidha ingest youtube --url <url>
```

The default (omitted or `distillation`) uses the new source-level distillation pipeline. This
toggle and the legacy path are deleted in AIDHA-TASK-012 Task 14 once the comparison checkpoint
passes.

## RunReport Additions

Ingestion summaries (both `RunReport` from the core pipeline and `IngestSummary` from the CLI
`--json` output) now carry two additional optional fields:

### `supportingUnits`

An array of non-claim knowledge units that were extracted but projected to `supportingEvidence`
or `procedure` roles:

```json
"supportingUnits": [
  {
    "kind": "example",
    "text": "...",
    "supportsUnitIds": ["u3"],
    "excerptIds": ["excerpt-42"]
  }
]
```

These are not graph knowledge candidates. They provide audit trail for examples and procedures
that the model identified but that the projection policy did not route to claims. They are not
`rejectedClaims` — they were not rejected; they were demoted by design.

### `sourceDistillation`

A summary of the distillation pass result:

```json
"sourceDistillation": {
  "failedClosed": false,
  "sourceType": "explainer",
  "sourceCoherence": "single_topic",
  "theses": ["..."],
  "coverage": {
    "citedExcerptCount": 14,
    "excerptsCitedPercent": 70.0,
    "citedTextPercent": 68.3,
    "largestUncitedGapSeconds": 42,
    "coreUnitsWithoutVerifiedEvidence": 0,
    "weakQuoteCount": 1
  },
  "unitCountsByKind": { "idea": 4, "recommendation": 2, "limitation": 1, "example": 3 },
  "relations": [
    { "type": "limits", "sourceUnitId": "u5", "targetUnitId": "u2" }
  ],
  "diagnostics": []
}
```

### `rejectedClaims` — meaning under the distillation path

`rejectedClaims` on the distillation path contains only units that were **demoted as bad
graph-claim candidates**: units whose grounding verdict was `ungrounded`, or units that failed
quote verification entirely. They are diagnostic evidence for prompt or model improvement.

They do **not** include examples or procedures. Those land in `supportingUnits` instead.
Do not use `rejectedClaims` entries as accepted source facts.

## Claim-Quality Model Ladder

Use the narrow eval harness to separate model capability from prompt and pipeline faults.

- Routine production candidates: `gpt-5.4-mini`, `gpt-5.4-nano`.
- Cross-provider comparison: `gemini-3.5-flash`.
- Capability-ceiling diagnostic: `gpt-5.5`.
- Oracle-only golden-example generation: `gpt-5.5-pro`; do not run it in routine
  evaluation without deliberate cost approval.

For private pilot comparisons, use cached transcripts and compare the same source through
`gpt-5.4-mini`, `gpt-5.4-nano`, and `gemini-3.5-flash` before changing the default production
candidate. Escalate to `gpt-5.5` only when the routine ladder cannot distinguish prompt faults
from model-capability faults.

## Diagnostics

```bash
pnpm -C packages/praecis/youtube cli diagnose transcript <video-url>
pnpm -C packages/praecis/youtube cli diagnose extract <video-url>
```

`diagnose extract` reports claim state distribution, method counts, and provenance gaps. For the
distillation path, also inspect `sourceDistillation.diagnostics` and `sourceDistillation.coverage`
in the `--json` output.

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
