---
document_id: AIDHA-PLAN-010
owner: Product
status: Draft
version: "0.1"
last_updated: 2026-06-12
title: Source-Level Claim Distillation
type: PLAN
docops_version: "2.0"
area: CORE
keywords: [claims, extraction, distillation, knowledge-units, grounding, coverage, graph]
related_ids: [AIDHA-PLAN-007, AIDHA-PLAN-008, AIDHA-PLAN-009, AIDHA-TASK-011]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PLAN-010
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-06-12
> **Type:** PLAN

# Source-Level Claim Distillation

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-06-12 | AI     | Replace chunk-local claim mining with a source-level distillation architecture after the r9 retrial showed structural fixes did not produce graph-worthy claims. Incorporates two rounds of external peer review. | - | Draft | AIDHA-PLAN-009 |

## Purpose

The r9 private YouTube retrial confirmed that AIDHA-PLAN-009 fixed the output-safety boundary (rejected claims no longer reach the graph) but not extraction quality itself. Reviewable claims remain procedural, thin, duplicated, or written as reportage; significant source ideas are missing entirely.

This plan replaces the chunk-local claim-mining architecture with a source-level distillation pipeline. The model first builds a structured understanding of the whole source; graph claims are then a deterministic projection of that understanding, verified for groundedness before persistence.

## Diagnosis: Why Chunk Mining Cannot Produce Graph-Worthy Claims

The r9 failure is architectural, not prompt-tuning:

- **Forced extraction:** the per-chunk minimum claim floor (`DEFAULT_MIN_CLAIMS_PER_CHUNK = 5`) compels the model to manufacture claims from chunks containing one idea and several minutes of demo. Procedural UI steps and demo observations are the predictable residue.
- **No whole-source view:** claims are mined per ~10-minute window and never reconciled against a source-level understanding, so the thesis can be missed while incidental detail is extracted. The source synopsis is derived from the claims — backwards.
- **Duplicates by construction:** chunk overlap plus no global consolidation produces near-duplicate claims (the r9 RAG recommendation pair).
- **Topic-overfit gating:** the deterministic quality gate hardcodes the vocabularies of the two pilot sources (`KNOWLEDGE_SYSTEM_PATTERN`, `ACADEMIC_DRIFT_PATTERN`) and a fixed connective-phrase list (`REASON_BEARING_PATTERN`). It can only reject, never repair — which is how a substantively important claim was lost to `weak_rationale`. Every new source topic would require new regexes; this layer is structurally a losing game.
- **Rule-soup prompting:** ~40 CRITICAL/Requirement lines plus prompt packs and config variants. Each pilot failure added rules; models satisfy rules mechanically, producing exactly the box-ticking `supportSummary` symptom observed in r9.
- **Unnecessary chunking:** typical source transcripts (10–25k tokens) fit comfortably in one call for every model on the evaluation ladder. The chunk apparatus solves a context problem that mostly does not exist and directly causes the failures above.

A schema upgrade alone is also insufficient: a required field can force a box-ticked value as easily as a missing one. Quality must come from four cooperating mechanisms — typed schema, deterministic quote verification, coverage diagnostics, and an LLM grounding pass that can repair as well as reject.

## Architecture

```text
transcript excerpts (IDs + timestamps preserved)
   |
   +- [only if > ~30k tokens] Pass 0: Section Notes (high-recall, per ~8k-token section)
   |
   +- Pass 1: Distillation (one call) -> SourceDistillation
   |
   +- Deterministic verification: parse/Zod -> ID/reference integrity -> quote verification -> coverage diagnostics
   |
   +- Pass 2a: Grounding (per unit + cited excerpts): grounded | rewrite | ungrounded
   +- Pass 2b: Consolidation (all grounded units): merge + typed relations
   |
   +- Projection (pure function, no LLM): units -> DraftClaims + supporting units + synopsis + diagnostics
   |
   +- Sanity gate (deterministic, topic-agnostic only)
```

The extraction prompt's organizing question is: "What would a future reasoning agent need to know from this source?" Coverage metrics are computed downstream and are never described in the prompt (anti-gaming).

### Pass 0: Section Notes (long sources only)

Sources above a configurable token threshold (default ~30k) get a per-section notes pass before distillation. Notes must be high-recall, not summaries: candidate important ideas, verbatim supporting snippets, named entities/tools, recommendations and limitations, and "unclear but possibly important" observations. Section coverage stats accompany the notes so the distillation pass can detect ignored regions. Below the threshold, the whole transcript goes directly to Pass 1; the downstream pipeline is identical in both modes.

### Pass 1: Distillation Schema

```ts
interface SourceDistillation {
  schemaVersion: number;
  sourceType: 'explainer' | 'tutorial' | 'interview' | 'talk' | 'demo' | 'compilation' | 'other';
  sourcePurpose?: string;            // optional; weak/generic purpose -> diagnostic, never a forced field
  sourceCoherence: 'single_topic' | 'multi_topic' | 'mixed' | 'unclear';
  theses: string[];                  // may be empty -> diagnostic, not failure
  units: KnowledgeUnit[];
}

interface KnowledgeUnit {
  id: string;                        // model-emitted short id (u1, u2, ...); validated, re-keyed to durable hashed ids downstream
  kind: 'idea' | 'mechanism' | 'fact' | 'recommendation' | 'limitation' | 'example' | 'procedure';
  text: string;                      // canonical, standalone, no reportage wrappers
  rationale?: string;
  conditions?: Array<{ type: 'temporal' | 'scale' | 'audience' | 'assumption' | 'exclusion'; text: string }>;
  attribution?: { kind: 'speaker' | 'named_third_party' | 'study' | 'tool_output'; name?: string };
  stance: 'asserted' | 'recommended' | 'demonstrated' | 'reported' | 'speculative' | 'contested';
  evidence: Array<{ excerptId: string; quote: string }>;
  supportsUnitIds?: string[];
  importance: 'core' | 'supporting' | 'incidental';
}
```

Schema refinements (Zod):

- `recommendation` requires `rationale`.
- `limitation` requires `rationale` OR non-empty `conditions` (grounding pass 2a may additionally recover a limiting factor stated in cited evidence).
- `supportsUnitIds` must reference existing unit ids; ids must be unique.
- `evidence` non-empty for every unit.

Field semantics:

- `attribution` says who; `stance` says how to interpret. "Karpathy reported X" is `named_third_party` + `reported` and the name is preserved in claim text; "the presenter says Y" is `speaker` attribution and is normalized away.
- `conditions` is a typed array, not named slots, so there are no fields to ritually populate. Temporal conditions mark claims as future re-verification candidates.
- The model emits only `{excerptId, quote}` evidence; `localTranscriptRef`/`sourceRef` remain derived downstream as today.
- `graphProjection` is deliberately NOT model-emitted (self-grading invites rubber-stamping); see Projection.

### Quote Verification (deterministic)

Each evidence `quote` is verified against the same normalized excerpt text the model saw (raw excerpt retained separately):

- Normalization: whitespace, punctuation, casing, timecode artifacts.
- Minimum quote length: 5 words (a quote of "current models" verifies nothing).
- Maximum quote length: 50% of the cited excerpt (whole-chunk quotes are citation theater).
- Each evidence ref records `quoteVerification: 'exact' | 'normalized' | 'fuzzy' | 'failed'`.

This is the topic-agnostic groundedness check that replaces the deleted vocabulary regexes: it is free, deterministic, and catches hallucinated evidence before any LLM judging.

### Coverage Diagnostics (deterministic, diagnostic-only)

Computed after verification, never used as a hard acceptance gate, never described in prompts:

- percent of excerpts cited by at least one unit, and cited duration/text percentage;
- largest contiguous uncited time-gap;
- core-unit evidence coverage (do `core` units cite verified quotes?);
- unsupported/weak quote count;
- for Pass 0 runs: large uncited sections that section notes flagged as information-dense.

These metrics directly measure the "significant claims are missing" failure class, which schema typing alone cannot.

### Pass 2a: Grounding (local)

Per unit, a judge sees only the unit and its cited excerpts and returns `grounded`, `rewrite` (with corrected canonical text and/or recovered rationale from the cited evidence), or `ungrounded`. Unlike the previous regex gate, this pass can repair salvageable units instead of only destroying them.

### Pass 2b: Consolidation (global)

A single pass over all grounded unit texts (no transcript; cheap) emits typed relations: `merged_duplicate | supports | example_of | refines | limits | contrasts`, with `mergedFromUnitIds` preserved on merges.

Pipeline behavior is deliberately limited to three relations for now:

- `merged_duplicate`: units merge; provenance unions.
- `supports` / `example_of`: wired into `supportsUnitIds` (the r9 "25 wiki pages" unit becomes example-of a mechanism, not a claim).
- `limits`: folded into the target unit's `conditions` or linked (the r9 RAG pair is "recommendation + temporal limitation", not a duplicate).

`refines`/`contrasts` are recorded in diagnostics for the graph layer to consume later; consolidation must not grow into a general relation extractor (graph-edge construction belongs to the graph backend per AIDHA-PLAN-007).

### Projection (pure function, no LLM)

`graphProjection: 'claim' | 'supportingEvidence' | 'procedure' | 'diagnostic'` is computed deterministically from `(extractionIntent, sourceType, kind, importance)` and exhaustively unit-tested.

`extractionIntent` is a run-level parameter (CLI/config), default `knowledge_graph`:

- `knowledge_graph` (default): `idea | mechanism | fact | recommendation | limitation` with `core | supporting` importance project to claims; `example`/`procedure` project to supporting units even for tutorial sources; `incidental` units project to diagnostics.
- `runbook`: procedures may project to instruction claims.
- `source_summary`: synopsis-weighted projection.
- `task_extraction`: action items may project (future).

The synopsis flips direction: `theses` + `sourcePurpose` + units ARE the synopsis; claims are the graph-worthy projection of the distillation, not its input.

### Sanity Gate (deterministic, topic-agnostic only)

Retained checks: schema validation, prose completeness, generic reported-speech prefix, evidence refs resolve, near-duplicate text similarity across final claims. Deleted: `KNOWLEDGE_SYSTEM_PATTERN`, `ACADEMIC_DRIFT_PATTERN`, `REASON_BEARING_PATTERN`, domain-drift heuristics, and token-overlap inference heuristics (grounding owns entailment).

## Failure Policy (fail closed for graph persistence)

- Parse/Zod failure: one repair retry (re-prompt with the validation errors), then fail closed.
- Quote-verification failure rate above 30% of units: fail closed — the distillation as a whole is not trustworthy.
- Below the threshold: failed units are demoted to diagnostics; the rest proceed.
- Fail closed means: zero graph claims persisted, full `SourceDistillation` and diagnostics retained in the run report, warning surfaced in CLI output.
- An explicit `--allow-partial` style debug flag may bypass fail-closed for experiments only; it must never be a default.

## Run Report Shape

`rejectedClaims` means "bad graph claim candidate" only. Demoted examples/procedures are successful extraction and must not pollute rejection metrics:

- `claims`: reviewable graph claim candidates (`trusted=false`, per AIDHA-PLAN-009).
- `rejectedClaims`: failed candidates with reasons (ungrounded, failed quotes, sanity-gate failures).
- `supportingUnits`: examples/procedures with `supportsUnitIds` links.
- `sourceDistillation`: full distillation, coverage diagnostics, relations, thesis/purpose diagnostics.
- `qualitySummary`: extended with coverage and verification counts.

## Migration: Replace, With a Comparison Checkpoint

The new extractor implements the existing `ClaimExtractor` interface. No long-lived feature flag (pre-alpha; clean break preferred), but deletion is gated:

1. **Commit/PR 1:** land the distillation miner as the default extraction path. Chunk-mining code remains present and reachable via a temporary dev-only comparison script (old-vs-new on the same input).
2. **Checkpoint:** public suites green; private r9 rubric run by hand — core-idea recall versus the documented r9 misses, zero procedural claims under `knowledge_graph` intent, the RAG recommendation pair merged or condition-linked, rationale presence on recommendations. Docs-safe comparison notes captured (no private pilot content committed).
3. **Commit/PR 2:** delete the chunk-mining apparatus (`pass1-claim-mining-v2`, prompt packs, prompt routing, self-improve rounds, editor rewrite, chunking machinery) and the comparison script.

Kept infrastructure throughout: LLM client, circuit breaker, transport retry, response caching (re-keyed per pass and per `schemaVersion`), token estimation, `RunReport` plumbing.

## Model Policy

Start every pass on `gpt-5.4-mini`. Tiering (nano for notes/grounding) is an evaluation result, not a design commitment; run the AIDHA-PLAN-009 model ladder (`gpt-5.4-mini`, `gpt-5.4-nano`, `gemini-3.5-flash`) only after the schema and prompts are stable. `gpt-5.5-pro` only by deliberate approval for golden-example generation or capability-ceiling checks.

## Testing and Evaluation

Unit tests (fake LLM client; behavior, not wording):

- distillation parser: Zod refinements, ID uniqueness, reference integrity, repair-retry path;
- quote verification: normalization tiers, min/max length, failure statuses;
- coverage diagnostics computation;
- grounding verdict application (rewrite/ungrounded/merge with `mergedFromUnitIds`);
- projection function: exhaustive `(intent, sourceType, kind, importance)` table;
- failure policy: fail-closed thresholds and `--allow-partial` behavior.

Synthetic golden fixtures encoding general failure classes (recall as well as filtering):

- three core ideas must all be extracted, not one;
- demo example supports a mechanism claim (example-of wiring);
- procedural tutorial: procedures demoted under `knowledge_graph` intent, promoted under `runbook`;
- mixed-topic source must not force a single thesis;
- named third-party attribution preserved; speaker reportage normalized;
- recommendation + time-bound limitation consolidated into one conditioned claim;
- recommendation with recoverable rationale in evidence (grounding repair);
- box-ticking support and citation-spam patterns surfaced by diagnostics.

Private qualitative check: re-run the r9 source and compare per the migration checkpoint rubric. Private pilot outputs are never committed.

## Acceptance Bar

In addition to the AIDHA-PLAN-009 bar (which remains in force for trust semantics):

- r9 rerun captures the previously missed core ideas identified in qualitative review.
- Zero procedural/demo claims under `knowledge_graph` intent.
- All persisted claims carry at least one verified quote (`exact | normalized | fuzzy`).
- Duplicate/time-bounded recommendation pairs are merged or condition-linked.
- Coverage diagnostics present in every run report.
- Old-path deletion completed only after the comparison checkpoint passes.

## Implementation Reference

A coding-agent task plan (AIDHA-TASK-012) will be created from this plan before implementation.
