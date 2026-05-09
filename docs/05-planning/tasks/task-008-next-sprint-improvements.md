---
document_id: AIDHA-TASK-008
owner: Ingestion Engineering Lead
status: Draft
version: "0.4"
last_updated: 2026-05-09
title: Next Sprint Improvements and Backlog Burn-Down
type: TASK
docops_version: "2.0"
area: INGEST
keywords: [sprint-plan, backlog, reliability, provenance, docops]
related_ids: [AIDHA-TASK-007]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-008
> **Owner:** Ingestion Engineering Lead
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-05-09
> **Type:** TASK

# Task: Next Sprint Improvements and Backlog Burn-Down

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-08 | AI     | Initial sprint-ready task plan derived from planning audit and tech-debt backlog. | — | Draft | AIDHA-TASK-007 |
| 0.2     | 2026-05-08 | AI     | Reorder around unblocked engineering payoff, add readiness map, separate maintainer-gated work, and strengthen validation contracts. | — | Draft | AIDHA-TASK-007 |
| 0.3     | 2026-05-08 | AI     | Account for omitted backlog items with hygiene and extensibility sprint and complete scope criteria. | — | Draft | AIDHA-TASK-007 |
| 0.4     | 2026-05-09 | AI     | Record completed verification, extraction-maintainability, and speaker parser slices. | — | Draft | AIDHA-TASK-007 |

---

## Purpose

This task turns the remaining valid planning gaps into an executable improvement plan for the next
agent-managed sprints. It is scoped to work that is not already completed and not superseded by
newer eval, extraction, or review-loop implementations.

AIDHA-TASK-007 is the authoritative backlog ledger. This task provides ordering, readiness,
dependencies, and definitions of done for implementation PRs.

## Critical Assessment Incorporated

The sprint ordering was revised after review against engineering excellence, deliverability,
maintainability, extensibility, and code/test/doc alignment:

- TD-001 was missing despite being the highest-payoff, cleanest performance item. It is now first.
- TD-006 was too late for an architectural debt item. It now follows cheaper de-risking refactors
  TD-002 and TD-003 instead of being parked after unrelated work.
- Maintainer-gated items TD-014 and policy-dependent parts of TD-015 are no longer the first agent
  sprint. They live in a maintainer handoff section, with only unblocked doc artifacts kept in the
  agent-ready stream.
- TD-017 is narrowed to schema-version stamping and export version policy. A migration runner is
  explicitly deferred until a real migration is queued.
- TD-009, TD-012, and TD-013 are added as early watch/quick-close items.
- TD-004, TD-008, TD-010, and TD-011 are explicitly scheduled in a bounded hygiene and
  extensibility sprint. These are lower priority than TD-001/TD-006, but they should not disappear
  from a governed burn-down plan.
- Each PR must update AIDHA-TASK-007 in the same diff as the implementation.

## Audit Summary

The following sources were reviewed:

- `docs/05-planning/tasks/task-001-public-repo.md`
- `docs/05-planning/tasks/task-002-mvp-completion.md`
- `docs/05-planning/tasks/task-003-extraction-quality-atomic-breakdown.md`
- `docs/05-planning/tasks/task-004-claim-extraction-evaluation-matrix.md`
- `docs/05-planning/tasks/task-005-deferred-claim-improvements.md`
- `docs/05-planning/tasks/task-006-eval-refinement.md`
- `docs/05-planning/WIP-mvp.md`
- `docs/05-planning/WIP-mvp-strengthening.md`

Findings:

- MVP scope in `WIP-mvp.md`, `WIP-mvp-strengthening.md` milestones 1-6, and AIDHA-TASK-002 is
  complete or superseded by implemented review, retrieval, diagnostics, dossier, and eval features.
- AIDHA-TASK-004 contains stale unchecked implementation tasks, but its completion note and current
  source tree show the eval matrix, corpus schema, model registry, scorer, reports, quality gate,
  manual baseline, and cache invalidation are implemented.
- AIDHA-TASK-006 is complete.
- The remaining actionable gaps are recorded in AIDHA-TASK-007 as TD-001 through TD-020.

## Execution Principles

- Start each code task with a failing test or a failing documentation/DocOps check.
- Keep each PR independently reviewable and reversible.
- Treat AIDHA-TASK-007 as the state ledger. Each PR that resolves, splits, supersedes, or defers a
  backlog item must update that TD-NNN status block in the same diff.
- Do not reopen old WIP files as active plans. Supersede or migrate useful content into governed
  tasks only.
- Prefer current implementation evidence over stale checklist text when deciding whether work
  remains.
- Inherit the validation commands from each TD-NNN unless this task explicitly states a narrower
  command and why.

---

## Readiness Map

| Work package | Backlog IDs | Readiness | Notes |
| ------------ | ----------- | --------- | ----- |
| Performance quick wins | TD-001, TD-002, TD-003 | Unblocked today | Highest concrete payoff and natural lead-in to TD-006. |
| Ledger quick-close items | TD-009, TD-012, TD-013 | Unblocked today | Cheap greenfield/release hygiene; TD-013 may become CI action only if timeout reproduces. |
| Narrow baseline decomposition | TD-006 | Unblocked after characterization tests | Move early; do before more broad work in `narrow-manual-baseline.ts`. |
| Test hygiene and extensibility | TD-004, TD-008, TD-010, TD-011 | Unblocked today | Low-risk cleanup; schedule after TD-006 so it does not displace higher leverage work. |
| Extraction verification debt | TD-018 | Unblocked after re-audit | Does not require TD-006 if kept to verification/LLM/editorial modules. |
| Speaker attribution | TD-016 | Unblocked after parser false-positive fixtures | Touches transcript, ingest, prompt, and dossier docs. |
| Schema-version policy | TD-017 | Unblocked for stamping only | Migration runner deferred until a concrete migration exists. |
| Eval usage/provider strategy | TD-019, TD-020 | Unblocked after current eval client response audit | No native client until evidence shows a real gap. |
| Maintainer repository controls | TD-014 | Blocked on GitHub admin access | Handoff item, not an agent sprint blocker. |
| Contributor/trademark policy | TD-015 | Partially blocked on maintainer policy | Agent can draft `CITATION.cff`; CLA/trademark posture needs maintainer decision. |
| Logger abstraction | TD-007 | Unblocked | Keep after TD-006 unless needed sooner by test noise. |

## Sprint 0: Readiness and Cheap Closure

**Goal:** Make the ledger accurate and clear low-cost items before deeper refactors.

### T008-00-01: Confirm ledger readiness and PR protocol

- **Backlog IDs:** AIDHA-TASK-007 overall
- **Status:** Resolved
- **Owner:** Agentic coding orchestrator
- **Dependencies:** None

**Steps:**

1. Confirm AIDHA-TASK-007 item statuses match current source evidence for the items touched in the
   next PR.
2. For each PR, update the relevant TD-NNN status, resolution, split, or supersession note in the
   same diff.
3. Keep process validation as a pre-flight gate, not a standalone implementation sprint.

**Definition of done:**

- [x] The first implementation PR updates its TD-NNN status block in AIDHA-TASK-007.
- [x] `node scripts/meminit-check.mjs docs/05-planning/tasks/task-007-tech-debt-backlog.md docs/05-planning/tasks/task-008-next-sprint-improvements.md` passes.
- [x] `pnpm docs:build` passes.

### T008-00-02: Close release-note and greenfield ID policy quick wins

- **Backlog IDs:** TD-009, TD-012
- **Status:** Resolved
- **Owner:** Coding agent
- **Dependencies:** None

**Steps:**

1. For TD-012, add the embedding default change to the PR description or release note surface
   required by the active branch.
2. For TD-009, decide and implement the shortened-ID collision policy while the project is still
   greenfield.
3. Update AIDHA-TASK-007 with evidence for each item.

**Definition of done:**

- [x] TD-012 acceptance criteria are met, including explicit cache/eval comparability impact.
- [x] TD-009 acceptance criteria are met, including deterministic ID length and uniqueness tests.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/utils/ids.test.ts tests/claim-id-collision.test.ts --reporter=dot` passes when TD-009 changes code.
- [x] `pnpm docs:build` passes when TD-012 changes docs.

### T008-00-03: Watch lint reliability before it blocks CI

- **Backlog IDs:** TD-013
- **Status:** Resolved
- **Owner:** Coding agent or CI maintainer
- **Dependencies:** First GitHub Actions run with `pnpm lint`

**Steps:**

1. Check the current GitHub Actions run for `pnpm lint` completion.
2. If root lint times out in CI, split lint into explicit package-level steps.
3. If CI passes but local lint remains slow, document a package-level fallback.

**Definition of done:**

- [x] GitHub Actions evidence shows root `pnpm lint` passes or has been split by package.
- [x] The fallback preserves the CI contract order: lint, unit, integration.
- [x] Cross-sprint gates include `pnpm lint` or the documented package-level fallback.

---

## Sprint 1: Performance Quick Wins

**Goal:** Take the cleanest high-payoff engineering wins before deeper architecture work.

### T008-01-01: Parallelize judge scoring

- **Backlog IDs:** TD-001
- **Status:** Resolved
- **Owner:** Eval maintainer
- **Dependencies:** None

**Steps:**

1. Add a failing test showing multiple judge calls can complete independently and preserve
   partial-success semantics.
2. Extract the per-judge scoring path into a typed helper.
3. Replace serial judge execution with `Promise.allSettled`.
4. Preserve judge failure reporting, cost roll-up, and rate-limiter behavior.
5. Update TD-001 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] Successful judge scores are identical in content to the serial path.
- [x] A single judge failure does not prevent other judges from completing.
- [x] `judgeFailures` and `cellHasScoringFailure` are set correctly.
- [x] Focused matrix-runner tests cover concurrent calls and partial success.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/matrix-runner.test.ts --reporter=dot` passes.

### T008-01-02: Pre-index video cells before repeated per-video loops

- **Backlog IDs:** TD-002
- **Status:** Resolved
- **Owner:** Eval maintainer
- **Dependencies:** None

**Steps:**

1. Add or identify tests that cover per-video report, judge, and score output.
2. Build `harnessByVideoId` and `fallbackByVideoId` maps once.
3. Replace repeated `.filter(c => c.videoId === video.videoId)` calls inside video loops.
4. Keep output ordering unchanged.
5. Update TD-002 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] No repeated videoId filter remains inside video iteration loops for the targeted stage paths.
- [x] Existing narrow manual baseline output assertions still pass.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/narrow-manual-baseline.test.ts --reporter=dot` passes.

### T008-01-03: Extract comparable claim-set construction helper

- **Backlog IDs:** TD-003
- **Status:** Resolved
- **Owner:** Eval maintainer
- **Dependencies:** T008-01-02 preferred

**Steps:**

1. Read all comparable-claim-set construction sites and verify they are semantically equivalent.
2. Extract a typed helper that accepts pre-indexed maps if TD-002 has landed.
3. Replace duplicate construction sites.
4. Update TD-003 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] Comparable claim-set construction lives in one helper.
- [x] No candidate source is dropped or reordered unintentionally.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/narrow-manual-baseline.test.ts --reporter=dot` passes.

---

## Sprint 2: Narrow Baseline Decomposition

**Goal:** Address the highest maintainability risk before further broad eval changes accumulate.

### T008-02-01: Add characterization tests for narrow baseline reports and resume behavior

- **Backlog IDs:** TD-006
- **Status:** Resolved
- **Owner:** Eval maintainer
- **Dependencies:** T008-01-02, T008-01-03 preferred

**Steps:**

1. Add fixture-backed characterization tests for current JSON report shape.
2. Add characterization coverage for Markdown report output where deterministic.
3. Add resume-artifact reuse and invalidation characterization before moving code.
4. Commit tests separately before extraction work.

**Definition of done:**

- [x] Characterization tests fail if report structure or resume behavior drifts.
- [x] Tests use deterministic fixtures and no live LLM calls.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/narrow-manual-baseline.test.ts --reporter=dot` passes.

### T008-02-02: Extract coverage, rendering, teacher analysis, and artifact modules

- **Backlog IDs:** TD-006
- **Status:** Planned
- **Owner:** Eval maintainer
- **Dependencies:** T008-02-01

**Steps:**

1. Extract coverage scoring into a pure module with explicit input/output types.
2. Extract Markdown/JSON report shaping into a renderer module with deterministic ordering.
3. Extract teacher-aware analysis and gap hints into a focused module.
4. Extract validated artifact read/write into `StageArtifactStore`.
5. Reduce `runNarrowManualBaselineComparison` to context creation, sequencing, and persistence.
6. Update docs or developer comments only where exported module boundaries need explanation.
7. Update TD-006 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [ ] Coverage scoring, report rendering, teacher analysis, artifact persistence, and orchestration
  live in separate modules with explicit exported types.
- [ ] `runNarrowManualBaselineComparison` is orchestration-only and materially shorter.
- [ ] Generated JSON and Markdown reports are byte-identical for at least one deterministic
  fixture-backed run, except documented intentional ordering changes.
- [ ] `pnpm --dir packages/praecis/youtube test` passes.

---

## Sprint 3: Test Hygiene and Extensibility

**Goal:** Account for lower-priority backlog items that improve extensibility and test reliability
without displacing higher-payoff performance and architecture work.

### T008-03-01: Collapse provider config getters into a factory

- **Backlog IDs:** TD-004
- **Status:** Resolved
- **Owner:** CLI maintainer
- **Dependencies:** None

**Steps:**

1. Characterize the current provider config getters and their provider-specific differences.
2. Add a `ProviderConfigSpec` helper only where provider shapes are genuinely common.
3. Keep named provider wrappers so call sites and error messages remain stable.
4. Update TD-004 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] No provider config env-var lookup logic is duplicated across equivalent functions.
- [x] Provider-specific fields remain explicit rather than hidden behind a leaky abstraction.
- [x] Adding a new similar provider requires a new spec literal, not a copied function body.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/cli-config*.test.ts --reporter=dot` passes.

### T008-03-02: Clarify coverage scoring public/test boundary

- **Backlog IDs:** TD-008
- **Status:** Resolved
- **Owner:** Eval maintainer
- **Dependencies:** TD-006 preferred if coverage engine is moved first

**Steps:**

1. Decide whether coverage scoring is a supported production module or test-support surface.
2. If production-supported, move it into the extracted coverage module from TD-006.
3. If test-only, move adapters into a clearly named test-support boundary and avoid package
   re-export.
4. Update TD-008 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] There are no ambiguous test-only exports from `narrow-manual-baseline.ts`.
- [x] Coverage scoring tests still cover strict, semantic, and embedding modes.
- [x] Public package exports, if any, are intentional and documented in code.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/narrow-manual-baseline.test.ts --reporter=dot` passes.

### T008-03-03: Normalize config permission fixtures in test setup

- **Backlog IDs:** TD-010
- **Status:** Resolved
- **Owner:** CLI/config maintainer
- **Dependencies:** None

**Steps:**

1. Stop relying on repository mode bits for permission-sensitive tests.
2. Copy config fixtures into temp directories and explicitly chmod secure/insecure cases.
3. Assert warning behavior for insecure mode and no warning for secure mode.
4. Update TD-010 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] Permission-sensitive tests create temp config files with explicit mode bits.
- [x] Secure mode produces no warning.
- [x] Insecure mode produces the expected warning without silently mutating the file.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/cli-config-cmd.test.ts tests/cli-config-phase-gate.test.ts tests/cli-config.test.ts tests/cli-config-secrets.test.ts tests/cli-config-set.test.ts tests/cli-config-init.test.ts --reporter=dot` passes.

### T008-03-04: Strengthen LLM chunking regression assertions

- **Backlog IDs:** TD-011
- **Status:** Resolved
- **Owner:** Extraction maintainer
- **Dependencies:** None

**Steps:**

1. Update the semantic-overlap test to prove an overlap excerpt appears in adjacent chunk requests.
2. Update the hard max token split test to assert expected chunk count or chunk diagnostics.
3. Avoid brittle full-prompt snapshots; prefer excerpt IDs or normalized excerpt markers.
4. Update TD-011 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] Semantic-overlap test fails if overlap excerpts are removed.
- [x] Hard-max-token test fails if chunk count or token diagnostics exceed the expected fixture
  boundary.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/llm-claims.test.ts --silent --reporter=dot` passes.

---

## Sprint 4: Extraction and Verification Debt Closure

**Goal:** Burn down older deferred extraction-quality refactors without broad algorithm churn.

This sprint is intentionally after TD-006 unless the scoped re-audit proves a change does not touch
the narrow baseline coverage, rendering, teacher analysis, or orchestration modules.

### T008-04-01: Re-audit Task 005 against current code

- **Backlog IDs:** TD-018
- **Status:** Planned
- **Owner:** Extraction maintainer
- **Dependencies:** None

**Steps:**

1. For each open Task 005 item, classify it as implemented, still valid, superseded, or obsolete.
2. Update AIDHA-TASK-005 with evidence, or supersede it from AIDHA-TASK-007.
3. Split any item that is larger than one reviewable PR.

**Definition of done:**

- [ ] AIDHA-TASK-005 has no ambiguous open item.
- [ ] AIDHA-TASK-007 TD-018 lists only still-valid work or is marked resolved.
- [ ] `node scripts/meminit-check.mjs docs/05-planning/tasks/task-005-deferred-claim-improvements.md docs/05-planning/tasks/task-007-tech-debt-backlog.md` passes if those docs are touched.

### T008-04-02: Implement correctness-first verification refactors

- **Backlog IDs:** TD-018
- **Status:** Resolved
- **Owner:** Extraction maintainer
- **Dependencies:** T008-04-01

**Steps:**

1. Add tests for semantic-threshold override behavior.
2. Add tests for invalid n-gram sizes.
3. Implement threshold normalization and n-gram validation.
4. Run focused verification tests.

**Definition of done:**

- [x] Custom `semanticThreshold` produces the expected derived `entailmentThreshold`.
- [x] Invalid n-gram sizes fail explicitly.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/verification.test.ts --reporter=dot` passes.

### T008-04-03: Implement low-risk maintainability refactors

- **Backlog IDs:** TD-018
- **Status:** Resolved
- **Owner:** Extraction maintainer
- **Dependencies:** T008-04-02

**Steps:**

1. Replace magic token/cost warning values with named constants.
2. Clarify legacy cache fallback guard comments or conditions.
3. Reuse `DEFAULT_ECHO_DETECTION` as the single default source.
4. Add shared memoization only if at least two current call sites use it cleanly.

**Definition of done:**

- [x] Focused tests cover each changed behavior or boundary.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/verification.test.ts tests/llm-claims.test.ts tests/editorial-ranking.v2.test.ts tests/token-budget.test.ts --reporter=dot` passes.
- [x] No new public utility is added without at least one real production consumer.

---

## Sprint 5: Speaker Attribution Provenance

**Goal:** Preserve speaker context for interview and panel transcripts end to end.

### T008-05-01: Extend transcript schema and parsers with optional speaker metadata

- **Backlog IDs:** TD-016
- **Status:** Resolved
- **Owner:** Ingestion implementer
- **Dependencies:** None

**Steps:**

1. Add a failing schema test for transcript segments with and without `speaker`.
2. Add a failing parser test for known positive speaker-prefix formats.
3. Add false-positive fixtures for strings that must not be parsed as speakers:
   `Note:`, `Update:`, `Q:`, `A:`, `0:00`, `12:34`, URI schemes, and code-like `key: value`
   fragments.
4. Add optional `speaker?: string` to the transcript segment schema and type.
5. Implement conservative speaker-prefix parsing that strips the prefix only when confidence is
   high.

**Definition of done:**

- [x] Existing transcript fixtures parse unchanged.
- [x] Speaker-prefixed fixtures preserve timestamps and extract speaker metadata.
- [x] False-positive fixtures leave text untouched.
- [x] Parser comments document the confidence rule.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/transcript-parse.test.ts --reporter=dot` passes.

### T008-05-02: Persist, propagate, and document speaker metadata

- **Backlog IDs:** TD-016
- **Status:** Planned
- **Owner:** Ingestion and extraction implementer
- **Dependencies:** T008-05-01

**Steps:**

1. Add a failing pipeline test proving Excerpt nodes persist `speaker` when present.
2. Add a failing LLM prompt test proving excerpt JSON includes `speaker`.
3. Persist speaker metadata on Excerpt nodes.
4. Include speaker metadata in Pass 1 excerpt payloads.
5. Render speaker metadata in dossiers only when present.
6. Update the relevant schema/runbook/dossier docs, likely `docs/30-fdd/fdd-002-first-pass-youtube-claim-mining.md`, `docs/50-runbooks/runbook-003-youtube-ingestion.md`, or `docs/60-devex/ingest-quickstart.md` if user-facing output changes.
7. Update TD-016 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [ ] Excerpt metadata includes speaker when available.
- [ ] LLM prompt payload includes speaker for attributed excerpts.
- [ ] Dossier output for non-speaker transcripts is unchanged.
- [ ] Relevant schema/runbook/dossier docs are updated or explicitly deemed unaffected in the PR.
- [ ] `pnpm --dir packages/praecis/youtube exec vitest run tests/transcript-parse.test.ts tests/pipeline.test.ts tests/llm-claims.test.ts --reporter=dot` passes.
- [ ] `pnpm docs:build` passes.

---

## Sprint 6: Versioning Without Speculative Migration Framework

**Goal:** Preserve future migration optionality without shipping unused migration machinery.

### T008-06-01: Define and implement graph/export schema-version stamping

- **Backlog IDs:** TD-017
- **Status:** Resolved
- **Owner:** Data-model implementer
- **Dependencies:** None

**Steps:**

1. Identify graph node/edge payloads and exported machine-readable artifacts that need versioned
   contracts now.
2. Define where `schemaVersion` lives for those contracts.
3. Add tests that fail until new writes/exports include the version field.
4. Document compatibility expectations for pre-v1 greenfield data in the relevant runbook or DevEx
   guide.
5. Update TD-017 to note that migration-runner implementation is deferred until a concrete
   migration is queued.

**Definition of done:**

- [x] Version policy is documented in code comments or a governed doc.
- [x] New graph writes under selected contracts include `schemaVersion`.
- [x] Export JSON includes an artifact schema version.
- [x] Migration runner is not implemented unless a real migration is part of the same PR.
- [x] `pnpm --dir packages/reconditum test` passes if graph store code changes.
- [x] YouTube package test gate is not applicable; no YouTube package code changed.
- [x] `pnpm docs:build` passes.

---

## Sprint 7: Evaluation Cost and Provider Strategy

**Goal:** Improve evaluation cost accuracy and make provider routing an explicit architecture
choice.

### T008-07-01: Add actual usage capture to eval reports

- **Backlog IDs:** TD-019
- **Status:** Resolved
- **Owner:** Eval maintainer
- **Dependencies:** LLM clients expose usage metadata or fixtures simulate it

**Steps:**

1. Extend normalized LLM response metadata with optional token usage.
2. Update matrix runner cells to record actual and estimated usage separately.
3. Update report aggregation and Markdown/JSON output.
4. Add tests for usage-present, usage-absent, and mixed-provider runs.
5. Update eval docs if report fields or operator interpretation change.
6. Update TD-019 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] Reports distinguish actual usage from estimates.
- [x] Mixed usage availability is visible and not silently averaged.
- [x] Dry-run estimates still work without live calls.
- [x] Eval docs are updated or the PR explains why docs are unaffected.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/matrix-runner.test.ts tests/eval/report-files.test.ts --reporter=dot` passes.

### T008-07-02: Document provider-client routing decision

- **Backlog IDs:** TD-020
- **Status:** Resolved
- **Owner:** Eval maintainer and architecture reviewer
- **Dependencies:** Evidence from model routing tests and current eval runs

**Steps:**

1. Document whether the eval harness remains bridge-first or needs native provider clients.
2. Define triggers for adding native Anthropic or Gemini clients.
3. Update model registry metadata so bridge/native routing is visible.
4. Implement a native-client spike only if evidence shows a real capability gap.
5. Update TD-020 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [x] Provider strategy is documented in an ADR, task note, or eval runbook.
- [x] Model registry identifies bridge/native route for relevant models.
- [x] Native-client work is either explicitly deferred with triggers or implemented for one
  provider with tests.
- [x] `pnpm --dir packages/praecis/youtube exec vitest run tests/eval/model-routing.test.ts tests/eval/model-registry.test.ts --reporter=dot` passes.
- [x] `pnpm docs:build` passes.

---

## Sprint 8: Logger Abstraction

**Goal:** Make runtime output suppressible and testable after the highest-risk eval structure is
under control.

### T008-08-01: Introduce injectable logging

- **Backlog IDs:** TD-007
- **Status:** Planned
- **Owner:** YouTube package maintainer
- **Dependencies:** None

**Steps:**

1. Add minimal `Logger` interface and console/silent/buffered implementations.
2. Thread logger through high-chatter library entry points.
3. Leave CLI as the owner of user-facing stdout/stderr.
4. Replace tests that spy on `console.*` where practical.
5. Update TD-007 in AIDHA-TASK-007 with evidence.

**Definition of done:**

- [ ] Library modules under `src/extract`, `src/eval`, and `src/client` do not call `console.*`
  directly except examples in comments or explicitly documented exceptions.
- [ ] CLI modules either write directly to the console intentionally or inject a logger downstream.
- [ ] Quiet-mode or buffered-logger tests prove output can be suppressed.
- [ ] `pnpm --dir packages/praecis/youtube test` passes.

---

## Maintainer Handoff

These items are valid, but they are not good first sprint work for an autonomous coding agent
because they depend on repository administration or policy decisions.

### MH-001: Apply GitHub repository protection and security settings

- **Backlog IDs:** TD-014
- **Blocked on:** GitHub repository admin access

**Maintainer actions:**

1. Enable branch protection on `main` with required PR review and required CI checks.
2. Enable Dependabot security alerts.
3. Enable GitHub secret scanning when the account tier supports it.
4. Verify the `Secret Scan` workflow passes on GitHub.

**Evidence to record:**

- [ ] `gh api repos/:owner/:repo/branches/main/protection` returns active protection.
- [ ] `gh run list --workflow secret-scan.yml --limit 5` shows a passing run.
- [ ] AIDHA-TASK-001 no longer has unchecked GitHub settings without evidence or supersession.

### MH-002: Decide contributor-rights and trademark policy

- **Backlog IDs:** TD-015
- **Blocked on:** Maintainer decision on CLA versus DCO and trademark posture

**Maintainer actions:**

1. Decide whether AIDHA uses CLA enforcement, DCO sign-off, or no additional contributor-rights
   mechanism for now.
2. Decide whether to add explicit trademark guidance now.

**Agent-ready follow-up after decision:**

- [ ] Add `CITATION.cff` or supersede it in AIDHA-TASK-001.
- [ ] Add `TRADEMARKS.md` or supersede it in AIDHA-TASK-001.
- [ ] Update `CONTRIBUTING.md`.
- [ ] Run `test -f CITATION.cff` and `test -f TRADEMARKS.md` when those artifacts are required.
- [ ] Run `pnpm docs:build`.

---

## Cross-Sprint Verification Gate

Before each sprint branch is marked ready for review, run the smallest relevant focused tests plus:

- `pnpm lint`
- `pnpm --dir packages/praecis/youtube build`
- `pnpm --dir packages/aidha-config build`
- `node scripts/meminit-check.mjs docs/05-planning/tasks/task-007-tech-debt-backlog.md docs/05-planning/tasks/task-008-next-sprint-improvements.md`
- `pnpm docs:build`

If root `pnpm lint` times out locally, use the TD-013 package-level fallback and record it in the
PR:

- `pnpm --dir packages/aidha-config lint`
- `pnpm --dir packages/phyla lint`
- `pnpm --dir packages/reconditum lint`
- `pnpm --dir packages/praecis/youtube lint`

For branches touching shell scripts, also run:

- `bash -n <script>`
- `shellcheck <script>`

For branches touching CI, verify at least one GitHub Actions run and record the run URL in the PR.

## Done for Task 008

- [ ] Every AIDHA-TASK-007 item from TD-001 through TD-020 is resolved, superseded with evidence,
  split into a smaller governed task, or explicitly deferred beyond Task 008 with rationale.
- [ ] AIDHA-TASK-007 statuses match actual implementation state.
- [ ] Each implementation PR updates the relevant TD-NNN status block in AIDHA-TASK-007.
- [ ] All changed docs pass scoped Meminit, Markdownlint, and `pnpm docs:build`.
- [ ] Each implementation PR lists focused tests, package build commands, docs checks, lint command
  or fallback, and remaining deferred items.
