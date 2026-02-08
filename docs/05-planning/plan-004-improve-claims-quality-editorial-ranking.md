---
document_id: AIDHA-PLAN-004
owner: Product
status: Draft
version: "0.6"
last_updated: 2026-02-08
title: Improve Claim Quality and Editorial Ranking
type: PLAN
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PLAN-004
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-02-08
> **Type:** PLAN

# Improve Claim Quality and Editorial Ranking (Plan)

## Version History

| Version | Date       | Author | Change Summary                                     | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-07 | AI     | Initial plan + task breakdown.                     | -         | Draft  | -         |
| 0.2     | 2026-02-07 | AI     | Add current state, concrete defaults, and migration. | -         | Draft  | -         |
| 0.3     | 2026-02-07 | AI     | Clarify v2 heuristics + diagnostics API + tests.   | -         | Draft  | -         |
| 0.4     | 2026-02-07 | AI     | Resolve refactor boundaries + diagnostics shape.   | -         | Draft  | -         |
| 0.5     | 2026-02-07 | AI     | Clarify diagnose strategy + refine specificity heuristic. | - | Draft | - |
| 0.6     | 2026-02-08 | AI     | Promote to governed plan filename and reconcile implementation status. | - | Draft | - |

## Objective

Improve extracted claim quality so a dossier is usable on first export, while keeping:

- Determinism (same inputs => same outputs).
- Auditability (every claim grounded in excerpt timestamps).
- Low review friction (accept/reject/edit is fast because defaults are good).

Scope: claim extraction and editorial ranking in `packages/praecis/youtube`.

## Implementation Reconciliation (2026-02-08)

This plan has been implemented and validated in the `MVP` branch.

Implemented:

- Modularized editorial ranking (`v1`/`v2`) and shared extraction utilities.
- Deterministic quality metrics, diagnostics, and cache-backed diagnose editor flow.
- CLI wiring for editor controls and optional `--editor-llm` rewrite pass.
- Rewrite guardrails (numeric preservation, keyword overlap, edit ratio) plus tests.
- Doc updates across FDD/runbook/quickstart/testing and DocOps catalog regeneration.

Deferred by design (non-blocking):

- Prompt-coupling policy changes for pass 1 wording.
- Additional CLI profile/config UX consolidation if flags expand further.
- Any future scorer sub-versioning (`scoreVersion`) beyond current `editorVersion`.

## Technical Context

- Language/runtime: TypeScript (ESM), Node.js.
- Package: `packages/praecis/youtube`.
- Tests: Vitest (`pnpm -C packages/praecis/youtube test`).
- Primary file today: `packages/praecis/youtube/src/extract/llm-claims.ts`.
- Constraint: pass 2 editorial logic must be deterministic and runnable offline.
- Dependency policy for v2: no NLP/NER libraries; use simple regex/token heuristics.

## Constitution Check

- Graph-native scope: operate on existing `Claim` and provenance edges only.
- AI-augmented touchpoints: pass 1 mining uses LLM; pass 2 is deterministic.
- TDD strategy: add failing unit tests for editorial ranking deltas; keep offline.
- DevOps/DocOps impact: new flags/output require help-text tests + doc updates.
- pnpm workspace changes: none expected; if deps change, document and pin.

## Terminology

- "Codex-executable": structured so an AI coding agent can implement it incrementally
  (clear phases, explicit tests, concrete acceptance, and file paths).

## Current State and Gap Analysis

### What Already Exists (Do Not Rewrite)

In `packages/praecis/youtube/src/extract/llm-claims.ts` we already have:

- Pass 1 mining: chunking (default 5 minutes), candidates per chunk, caching.
- Pass 2 editorial selection via `runEditorPass()`:
  - `isLowValue()` using `LOW_VALUE_PATTERNS` (boilerplate filter).
  - `isTooShort()` v1 thresholds: `< 40` chars OR `< 6` words (fragment filter).
  - `dedupeCandidates()` using `normalizeKey()` and excerpt overlap (>= 0.8).
  - `selectDiverseCandidates()` using `chunkIndex` buckets for diversity.
- Scoring v1: `scoreCandidate()` = confidence-weighted + length-weighted.

### Problems Observed

- Incomplete/low-salience claims can survive (fragments, housekeeping, filler).
- Scoring is too shallow; it does not directly reward actionability or specificity.
- Diversity is tied to LLM chunk boundaries, not absolute timeline windows.
- There is no clear, testable "quality report" surface (drop reasons, coverage).
- Changing scoring can destabilize tests and outputs without explicit versioning.

## Working Definition of Better

Better claim sets satisfy:

- Completeness: no accepted claim triggers the fragment rules below.
- Salience: boilerplate is mostly eliminated by deterministic rules.
- Diversity: selected claims span multiple fixed time windows.
- Auditability: each claim cites excerpt(s) with timestamps; no provenance gaps.
- Determinism: same inputs produce identical outputs and ordering.

## Acceptance Criteria

### Quantitative (CI-enforced on fixtures)

Defaults used in CI unless overridden:

- `maxClaims=15`
- `minClaims=10` (best-effort; if fewer are available, emit diagnostics)
- `windowMinutes=5`
- `maxPerWindow=3`
- `minWindows=4`

For the fixture resource(s):

1. Selected accepted claim count is `>= 10` and `<= 15`.
2. No accepted claim fails readability rules (fragment + boilerplate thresholds).
3. Coverage: at least 4 windows contain at least 1 accepted claim.
4. Deterministic rerun: extraction produces identical claim IDs and ordering.

### Qualitative (reviewer-evaluated, not CI-enforced)

For a typical 10 to 30 minute video:

- Fewer than 2 accepted claims are "intro/sponsor/subscribe/thanks".
- Fewer than 2 accepted claims are obvious fragments.
- At least 5 accepted claims are actionable (steps, cautions, recommendations).

## Migration and Backward Compatibility

Changing editorial scoring changes selection and dossiers. Make this safe:

- Introduce explicit `editorVersion` for pass 2 (start with `v1`, add `v2`).
- Keep `v1` as default initially; make `v2` opt-in:
  - CLI flags > env vars > defaults.
  - env var: `AIDHA_EDITOR_VERSION=2`.
- Add metadata so users can see what produced a set:
  - resource-level extraction metadata includes `editorVersion`.
  - optionally claim-level metadata includes `editorVersion`.
- `scoreVersion` is not required for this sprint. If introduced later, treat it as a
  sub-version under an editor version (e.g., editor v2 + scorer v2.1).
- Do not retroactively rewrite existing accepted claims by default.

## Fixture Strategy

Use two fixture layers:

1. Unit fixtures: synthetic `ClaimCandidate[]` (inline JSON in tests).
2. Integration fixtures: reuse the existing offline pipeline fixtures in
   `packages/praecis/youtube/tests` and assert invariants, not exact text.

Rationale: unit tests should target editorial logic directly without the LLM,
while integration tests protect the end-to-end invariants.

## Task Plan and Status

### Phase 0: Characterize v1 behavior (guardrails)

- [x] Add `packages/praecis/youtube/tests/editorial-ranking.v1.test.ts` with
      explicit test names and stable candidate fixtures.
- [x] Add a small synthetic candidate set that exercises:
      boilerplate, fragment, dedupe (excerpt overlap), diversity (chunkIndex).
- [x] Add one "known bad" candidate that currently survives, to motivate v2.

Acceptance:

- `editorial-ranking.v1.test.ts > runEditorPassV1 is deterministic` passes.
- Characterization fixtures are captured and now protected by regression tests.

### Phase 1: Refactor pass 2 into a reusable module (no behavior change)

- [x] Create `packages/praecis/youtube/src/extract/editorial-ranking.ts`.
- [x] Export the new module from `packages/praecis/youtube/src/extract/index.ts`.
- [x] Move v1 functions from `llm-claims.ts` into the module:
      scoring, filtering, dedupe, diversity, stable ordering.
- [x] Export both a minimal and diagnostic API:
      - `runEditorPassV1(...) => ClaimCandidate[]`
      - `runEditorPassV1WithDiagnostics(...) => { selected: ClaimCandidate[];`
        `diagnostics: EditorialDiagnostics }`
- [x] Update `llm-claims.ts` to call `runEditorPassV1(...)`.
- [x] Refactor boundary note (avoid accidental behavior changes):
      - keep pass 1 parsing/mining logic in `llm-claims.ts`
      - move editorial-only helpers into `editorial-ranking.ts`
      - move shared primitives used by both mining and editorial into a shared file
        (e.g., `packages/praecis/youtube/src/extract/utils.ts`)
        Examples in current code: `normalizeText`, `toNumber`, `clamp`.

Acceptance:

- All existing extraction tests pass with no selection differences under v1.
- v1 characterization tests still pass (same ordering and selections).
- Explicit at-risk tests to regression-check in this phase:
  - `packages/praecis/youtube/tests/llm-claims.test.ts`
  - `packages/praecis/youtube/tests/claims-coverage.test.ts`

Diagnostics API note:

- Do not change `ClaimExtractor.extractClaims(...) => Promise<ClaimCandidate[]>` in this sprint.
- `cli diagnose extract` (and any JSON diagnostics output) should call the
  `WithDiagnostics` variant through the extraction pipeline, while normal extraction
  continues to return `ClaimCandidate[]` only.

`EditorialDiagnostics` shape (approximate, sufficient for tests):

```ts
type EditorialDiagnostics = {
  editorVersion: 'v1' | 'v2';
  totalCandidates: number;
  selectedCount: number;
  droppedCounts: Record<string, number>;
  windowCoverage: Array<{ windowIndex: number; selectedCount: number }>;
};
```

### Phase 2: Add deterministic quality metrics and reporting

- [x] Add pure helpers (no store access) in
      `packages/praecis/youtube/src/extract/editorial-metrics.ts`:
      `countFragments`, `countBoilerplate`, `timelineCoverage`, `dropCounts`.
- [x] Add tests with explicit thresholds and expected counts:
      `editorial-metrics.test.ts > counts fragments`,
      `editorial-metrics.test.ts > counts boilerplate`,
      `editorial-metrics.test.ts > computes coverage`.

Test file organization:

- `packages/praecis/youtube/tests/editorial-ranking.v1.test.ts` (Phase 0, v1 characterization)
- `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts` (Phase 3, v2 behavior)
- `packages/praecis/youtube/tests/editorial-metrics.test.ts` (Phase 2, shared metrics)

Acceptance:

- New metrics tests pass and are stable across reruns.

### Phase 3: Implement `v2` scorer (opt-in) and selection rules

Goal: improve quality without rewriting pass 1.

- [x] Add `runEditorPassV2(...)` behind `AIDHA_EDITOR_VERSION=2`.
- [x] Implement richer local signals (deterministic, heuristic-only, no NLP deps):
      - actionability: matches a curated imperative marker list (e.g., `do`, `avoid`,
        `use`, `try`, `stop`, `start`, `increase`, `decrease`, `step`, `rule`) or
        contains explicit step structure (`step 1`, `first`, `then`, `next`).
      - specificity: contains numbers/units (e.g., `10`, `%`, `mg`, `minutes`),
        or passes a "capitalized word density" heuristic:
        count capitalized tokens excluding the first token, then compute
        `capitalizedCount / wordCount` and threshold it.
        Add a "shouty" cap: if ratio > 0.8 (or most tokens are ALL-CAPS),
        treat specificity as neutral (or apply a small penalty).
      - evidence density: based on number of linked excerpts and excerpt text length
        (total chars or tokens) for the candidate's excerpt IDs.
      - penalties: boilerplate/fragment rules remain explicit and configurable.
- [x] Keep scoring maintainable (avoid "heuristic soup"):
      - compute bounded sub-scores in `[0..1]`
      - combine via weighted sum with explicit, documented weights
      - add unit tests that enforce relative ordering (useful > boilerplate) rather
        than brittle numeric thresholds.
- [x] Keep `dedupeCandidates` and `normalizeKey` but define explicit deltas:
      default: keep dedupe identical to v1 for v2. Any changes must be behind config
      and accompanied by tests.
- [x] Add time-window diversity based on `startSeconds`:
      `windowMinutes=5`, `maxPerWindow=3`, `minWindows=4`.
- [x] Backward compatibility: if `startSeconds` is missing, fall back to chunkIndex.

Acceptance:

- `editorial-ranking.v2.test.ts > v2 rejects boilerplate` passes.
- `editorial-ranking.v2.test.ts > v2 filters fragments` passes.
- `editorial-ranking.v2.test.ts > v2 enforces coverage windows` passes.
- `editorial-ranking.v2.test.ts > v2 deterministic ordering` passes.

### Phase 4: Diagnostics UX and CLI surfaces

- [x] Clarify diagnose responsibilities (two modes):
      - "graph health" diagnosis: reads only from the graph (existing behavior).
      - "editor explanation" diagnosis: uses cached pass 1 outputs and runs the
        editorial pass in-memory to produce drop reasons and coverage.
- [x] Keep `cli diagnose extract` as graph-health by default (no LLM, no cache read).
- [x] Add `cli diagnose editor <resource|videoId> --json`:
      - loads LLM cache and candidate set deterministically (no LLM calls)
      - runs `runEditorPassV1WithDiagnostics` or v2 equivalent
      - emits the editorial report: dropped counts, coverage, selected windows, editorVersion
      - if no cache exists: print "No cache found; run extraction first" and exit non-zero
- [x] Optional (if UX preferred): add `cli diagnose extract --include-editor` which
      attempts to run the editor explanation path, but never triggers a new LLM run.
- [x] Add an invariant test to prevent report drift:
      `selected.length + sum(droppedCounts) === totalCandidates` for the synthetic fixture.
- [x] Add flags for editor config and document precedence:
      `--editor-version`, `--window-minutes`, `--max-per-window`, `--min-windows`,
      `--min-words`, `--min-chars`.
- [x] Update help-text tests to cover the new flags explicitly.
- [x] Wire editorial diagnostics into existing diagnosis types:
      extend `ExtractionDiagnosis` in `packages/praecis/youtube/src/diagnose/index.ts`
      with an optional `editorial?: EditorialDiagnostics` field.

Acceptance:

- Help-text tests enumerate: `--editor-version`, `--window-minutes`, `--max-per-window`,
  `--min-windows`, `--min-words`, `--min-chars`.
- Diagnose JSON includes the report fields (validated with tests).

### Phase 5: Optional editorial rewrite (LLM) with provenance safety (gated)

This is optional and should not block the v2 deterministic improvements.

- [x] Add `--editor-llm` flag and keep it off by default.
- [x] Add a cache key for rewrite step:
      `(transcriptHash, candidateSetHash, promptVersion, model)`.
- [x] Define deterministic `candidateSetHash` inputs:
      sorted `(normalizedText, sortedExcerptIds, startSeconds)`.
- [x] Add a provenance safety test:
      rewritten text must not introduce unsupported facts beyond excerpts.
      Add additional guardrails:
      - preserve all numeric tokens present in the source claim/excerpts
      - enforce minimum keyword overlap with excerpt text (token overlap heuristic)
      - bound rewrite magnitude (token-level edit ratio threshold)

Acceptance:

- Mock-LLM tests validate schema + caching + provenance guardrails (including
  numeric preservation and keyword overlap).
- Rewrite guardrail thresholds are explicit design decisions to set in Phase 5 tests:
  - minimum keyword overlap ratio (proposal): `>= 0.3`
  - maximum edit ratio (proposal): `<= 0.5`

### Phase 6: Integration regression protection

- [x] Add a "golden-ish" integration suite that asserts invariants only:
      claim count range, coverage windows, determinism, and provenance links.
- [x] Ensure v1 remains stable; v2 is opt-in and has its own invariant suite.

Acceptance:

- CI fails fast on quality regressions without asserting exact claim text.

## Readability and Boilerplate Rules (Defaults)

Defaults are config values with tests. These are proposed v2 defaults. v1 current
thresholds are documented above in "Current State and Gap Analysis".

Fragment (v2 default proposal):

- < 8 words OR < 50 chars, OR ends with conjunction after trimming.

Boilerplate (v2 default proposal):

- regex patterns for: subscribe/like, sponsor, patreon, welcome back, thanks.

Coverage (v2 default proposal):

- `windowMinutes=5`, `maxPerWindow=3`, `minWindows=4`.

## Open Questions and Risks

- Prompt coupling: do we relax the pass 1 prompt and rely more on pass 2 filters?
- Prompt coupling timeline: defer until after Phase 3 lands and diagnostics are in place.
- Config surface area: keep precedence simple (flags > env > defaults) and avoid
  adding more knobs than we have tests for.
- CLI UX risk: `extract claims` already has multiple flags; consider profiles/config later
  if the surface area grows further.
- Score instability: changing v2 rules changes dossiers; consider persisting
  `editorVersion` and exposing it in dossier headers.
- `minClaims` diagnostics: decide whether shortfall becomes stderr warning, diagnose JSON,
  and/or non-zero exit code in CI fixtures.
- Editorial rewrite risk: ensure rewrite does not invalidate excerpt grounding.
- "No NLP deps" tension: if specificity heuristics are too noisy, drop them or tighten them
  rather than adding NLP.
- Doc sync: when Phase 1-4 land, update `docs/55-testing/testing-001-mvp-tests.md` and the
  editorial-pass FDD to reflect new module/tests.

## References

- `packages/praecis/youtube/src/extract/llm-claims.ts` (current pass 1 + pass 2).
- AIDHA-ADR-006 (claim lifecycle), AIDHA-ADR-007 (two-pass extraction).
- AIDHA-FDD-002 (first pass), AIDHA-FDD-003 (editorial second pass).
