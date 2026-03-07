---
document_id: AIDHA-PLAN-006
owner: Ingestion Engineering Lead
status: Draft
version: "0.2"
last_updated: 2026-03-05
title: Verification and Keyphrase Extraction Refactor
type: PLAN
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PLAN-006
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-03-05
> **Type:** PLAN

# Verification and Keyphrase Extraction Refactor

## Version History

| Version | Date       | Author | Change Summary                                                                                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-03-05 | AI     | Initial spec-first/TDD plan for verification and keyphrase refactor.                                       | —         | Draft  | TASK-003  |
| 0.2     | 2026-03-05 | AI     | Add domain-agnostic + edge-case test strategy, temporary-list governance policy, and follow-on guardrails. | —         | Draft  | TASK-003  |

## Objective

Fix incorrect keyphrase extraction semantics and reduce scope creep in
`verification.ts`, while keeping behavior deterministic and testable per
`engineering-principles.md` (see repo root).

## Problem Statement

Current implementation couples two concerns:

1. Grounding verification logic (Tier 1/2/3 overlap checks).
2. Keyphrase extraction heuristics with a massive `COMMON_NOUNS` list.

Defects and risks:

1. Inverted semantics: terms in `COMMON_NOUNS` are currently _included_ as keyphrases.
2. Maintainability failure: ~1000+ uncurated lexical entries inside verification path.
3. Architectural drift: verification module owns linguistic resources beyond tier logic.

## Scope

In scope:

1. Correct keyphrase inclusion/exclusion semantics.
2. Split keyphrase logic from verification tier orchestration.
3. Replace mega-list with lean, reviewable generic-term suppression set.
4. Add cross-domain keyphrase fixtures (health + at least one non-health domain).
5. Update tests first (red), then code (green), then cleanup/refactor.

Out of scope:

1. Introducing external NLP libraries for this refactor.
2. Corpus-wide IDF/DF weighting (tracked separately).
3. CLI or API surface redesign.

## Target Design

### Module boundaries

1. `verification.ts`:
   - Tiered verifier orchestration.
   - Token/n-gram overlap utilities.
2. `keyphrases.ts` (new):
   - `extractKeyPhrases(text: string): string[]`
   - Internal helpers for proper-noun extraction and generic-term suppression.

### Semantics Principle

`extractKeyPhrases()` is a deterministic salience heuristic for verification support,
not a full linguistic noun-classifier.

### Extraction semantics

1. Include:
   - Multi-word capitalized entities (e.g., "Artificial Intelligence").
   - Acronyms (e.g., `ATP`, `HTTP`, `GPU`).
   - Hyphenated/alphanumeric domain terms (e.g., `T-cell`, `COVID-19`, `state-of-the-art`).
   - Lowercase candidate tokens meeting minimum quality filters.
2. Exclude:
   - Stopwords.
   - Very short tokens.
   - Ultra-generic nouns (small curated set, ~50-100 max).
   - Sentence-initial capitalization alone (e.g., `Study`) as entity signal.
3. Preserve:
   - Deterministic output ordering.
   - Duplicate removal.

### GENERIC_TERMS Policy

1. Status: temporary scaffold (not long-term architecture).
2. Hard cap: maximum 100 entries.
3. Ownership: Ingestion Engineering Lead (or delegate) approves modifications.
4. Change rule: each new term requires benchmark-linked rationale in PR notes.
5. Deprecation target: replace list-based suppression with
   corpus-adaptive DF/IDF weighting in follow-on planning ticket.

## TDD Plan (Red → Green → Refactor)

### Phase 1: Failing tests (Red)

Add/update tests in `packages/praecis/youtube/tests/verification.test.ts`:

1. `extractKeyPhrases` excludes ultra-generic terms when isolated:
   - Input: `"The study shows significant results from the research"`
   - Assert generic-only inputs no longer dominate output.
2. `extractKeyPhrases` retains meaningful domain terms:
   - Input: `"Leucine stimulates muscle protein synthesis"`
   - Assert inclusion of `leucine`, `muscle`, `protein synthesis` or equivalent
     deterministic phrase set.
3. `extractKeyPhrases` retains non-health domain terms:
   - Input: `"Kubernetes clusters use etcd for state storage"`
   - Assert inclusion of `kubernetes`, `etcd`, and storage-related phrase/terms.
4. `extractKeyPhrases` retains proper nouns:
   - Input: `"Artificial Intelligence is transforming healthcare"`
   - Assert inclusion of `artificial intelligence`.
5. `extractKeyPhrases` retains acronyms:
   - Input: `"ATP and HTTP are protocol/energy acronyms"`
   - Assert inclusion of `atp`, `http`.
6. `extractKeyPhrases` retains hyphenated/alphanumeric terms:
   - Input: `"COVID-19 and T-cell responses are state-of-the-art findings"`
   - Assert inclusion of `covid-19`, `t-cell`, `state-of-the-art`.
7. `extractKeyPhrases` resists sentence-initial capitalization false positives:
   - Input: `"Study results vary"`
   - Assert sentence-initial capitalization does not by itself imply named entity extraction.
8. `extractKeyPhrases` keeps dedupe guarantees.

### Phase 2: Minimal implementation (Green)

1. Create `src/extract/keyphrases.ts`.
2. Move extraction logic from `verification.ts` to `keyphrases.ts`.
3. Replace `COMMON_NOUNS` mega-list with curated `GENERIC_TERMS` set.
4. Invert filtering semantics to suppress generic terms rather than include them.
5. Re-export `extractKeyPhrases` via `src/extract/index.ts` without changing public import path.
6. Resolve `matchesNounPattern` public API status:
   - remove in this breaking-change pre-alpha branch, or
   - keep as deprecated alias with explicit semantic note.

### Phase 3: Refactor hardening

1. Remove dead helpers/constants from `verification.ts`.
2. Keep utility naming aligned with behavior.
3. Ensure semantic verification still composes n-gram + phrase overlap unchanged.

## Acceptance Criteria

1. All tests pass in [packages/praecis/youtube/tests/verification.test.ts](packages/praecis/youtube/tests/verification.test.ts).
2. No large uncurated noun list remains in `verification.ts`.
3. `extractKeyPhrases` behavior demonstrates:
   - Proper nouns included.
   - Generic terms suppressed.
   - Acronyms and hyphenated/alphanumeric technical terms retained.
   - Deterministic deduped output.
4. Public API for `extractKeyPhrases` remains available from package exports.
5. Generic-only overlap must not be amplified by keyphrase extraction in semantic verification.

## Plan Review

Review checkpoints before merge:

1. Spec alignment:
   - Confirms separation of concerns and modularization.
2. Correctness:
   - Verifies inverted logic is fixed by tests, not assumption.
3. Maintainability:
   - Generic term list size and ownership are explicitly bounded.
4. TDD compliance:
   - Commit history reflects failing-test-first workflow.
5. DocOps:
   - Metadata and Version History updated in same PR as code changes.

## Risks and Mitigations

1. Risk: Over-pruning terms may lower recall.
   - Mitigation: keep deterministic tests for meaningful-domain terms.
2. Risk: Behavior drift in semantic scoring.
   - Mitigation: preserve `verifySemantic` weighting and phrase-overlap math.
3. Risk: Hidden downstream expectations of old behavior.
   - Mitigation: keep export path stable and validate existing tests end-to-end.
4. Risk: `GENERIC_TERMS` grows into another unreviewable lexicon.
   - Mitigation: enforce hard cap and require benchmark justification for additions.

## Follow-On Guardrails

1. Add CI guardrail test/check that fails when `GENERIC_TERMS` exceeds configured cap.
2. Add optional keyphrase diagnostics mode (rule-level include/exclude reasons) for future debugging.
3. Move ad hoc phrase assertions toward fixture corpus files under `tests/fixtures/keyphrases/`.
