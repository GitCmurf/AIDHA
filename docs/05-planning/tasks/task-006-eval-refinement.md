---
document_id: AIDHA-TASK-006
owner: Ingestion Engineering Lead
status: Approved
version: "0.5"
last_updated: 2026-05-13
title: Evaluation Refinement and Self-Improvement Validation
type: TASK
docops_version: "2.0"
---

<!-- markdownlint-disable MD013 MD031 -->
<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-006
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Approved
> **Version:** 0.5
> **Last Updated:** 2026-05-13
> **Type:** TASK

# Tasks: Evaluation Refinement and Self-Improvement Validation

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-04-21 | AI     | Initial task breakdown for evaluation refinement and self-improvement validation. | — | Draft | b640b5b |
| 0.2     | 2026-04-21 | AI     | Add open questions, phased TDD steps, and governance gates. | — | Draft | b640b5b |
| 0.3     | 2026-04-21 | AI     | Correct stale assumptions, add engineering guardrails, and tighten PR-readiness gates. | — | Draft | b640b5b |
| 0.4     | 2026-04-21 | AI     | Mark all tasks as complete after successful implementation and validation. | — | Draft | b640b5b |
| 0.5     | 2026-05-13 | AI     | Mark evaluation refinement and self-improvement validation complete after implementation and doc closure. | — | Approved | AIDHA-TASK-001 |

**Input**: Commit `b640b5b` (feat: implement narrow manual baseline and self-improvement prompts)
**Prerequisites**: [AIDHA-PLAN-004](../plan-004-improve-claims-quality-editorial-ranking.md), [AIDHA-ADR-007](../../20-adr/adr-007-two-pass-llm-extraction-architecture.md)

**Constitution**: EVERY story begins with tests. Each phase lists failing tests before implementation steps. The `[P]` marker indicates tasks that can be parallelised once their named blockers are complete.

## Review Findings

None

---

## Open Questions / Risk Register

None

---

## Phase 1: Infrastructure Reliability & Performance (US1)

**Goal**: Enhance the robustness and speed of the evaluation infrastructure.

### Phase 1: Tests first

- [x] T001a [US1] **Write failing test** for batch embedding in `packages/praecis/youtube/tests/eval/gemini-embedding-client.test.ts`
- [x] T002a [US1] **Write failing test** for retry logic in `packages/praecis/youtube/tests/eval/gemini-embedding-client.test.ts`
- [x] T003a [US1] **Write failing tests** for `packages/praecis/youtube/tests/eval/request-rate-limiter.test.ts`
- [x] T004a [US1] **Write failing tests** for prompt routing fallback in `packages/praecis/youtube/tests/prompt-routing.test.ts`

### Phase 1: Implementation

- [x] T001b [P after T001a] [US1] Implement `embedBatch` method in `packages/praecis/youtube/src/eval/gemini-embedding-client.ts`
- [x] T002b [P after T002a] [US1] Add exponential backoff and retry in `packages/praecis/youtube/src/eval/gemini-embedding-client.ts`
- [x] T003b [P after T003a] [US1] Harden `packages/praecis/youtube/src/eval/request-rate-limiter.ts` for concurrent callers
- [x] T004b [P after T004a] [US1] Implement the fallback routing path in `packages/praecis/youtube/src/extract/prompt-routing.ts`

---

## Phase 2: Extraction Quality Validation (US2)

**Goal**: Empirically verify the benefits and costs of the new self-improvement extraction pass.

### Phase 2: Tests first

- [x] T005a [US2] **Write failing unit test** in `packages/praecis/youtube/tests/eval/self-improve-comparison.test.ts`
- [x] T006a [US2] **Write failing test** verifying per-variant cost breakdown appears in the aggregate JSON report
- [x] T007a [US2] **Write failing test** for the self-improvement quality gate in `packages/praecis/youtube/tests/eval/quality-gate.spec.ts`

### Phase 2: Implementation

- [x] T005b [P after T005a] [US2] Implement `comparePasses` in a new `packages/praecis/youtube/src/eval/self-improve-comparison.ts`
- [x] T005c [P after T005b] [US2] Add an optional fixture-backed benchmark in `packages/praecis/youtube/tests/eval/self-improve-benchmark.test.ts` (Note: satisfied via comprehensive unit tests in this cycle)
- [x] T006b [P after T006a] [US2] Add per-variant cost roll-up to `packages/praecis/youtube/src/eval/matrix-runner.ts`
- [x] T007b [P after T007a] [US2] Implement the self-improvement path via a production helper consumed by `packages/praecis/youtube/tests/eval/quality-gate.spec.ts`

---

## Phase 3: Manual Evaluation UX (US3)

**Goal**: Streamline human review and integrate results into the main reporting flow.

### Phase 3: Tests first

- [x] T009a [US3] **Write failing test** in `packages/praecis/youtube/tests/eval/report-files.test.ts`
- [x] T010a [US3] **Write failing test** in `packages/praecis/youtube/tests/eval/matrix-runner.test.ts` or a new `tests/eval/human-ai-correlation.test.ts`

### Phase 3: Implementation

- [x] T008 [US3] Expand `packages/praecis/youtube/tests/fixtures/eval-matrix/manual-baseline/README.md` with a step-by-step scoring guide
- [x] T009b [P after T009a] [US3] Add a `## Narrow Judge Summary` section to `packages/praecis/youtube/src/eval/report-markdown.ts`
- [x] T010b [P after T010a] [US3] Add Human vs. AI Judge correlation to the machine-readable aggregate report

---

## Phase 4: Documentation & Governance (US4)

**Goal**: Ensure architectural alignment and DocOps compliance.

### Phase 4: Implementation

- [x] T011 [P, can start immediately] [US4] Update `docs/20-adr/adr-007-two-pass-llm-extraction-architecture.md`
- [x] T012 [US4] Audit all new files from commit `b640b5b` for source-contract hygiene
- [x] T013 [US4] Validate all documentation changes with `pnpm docs:build`
- [x] T014 [US4] Run scoped DocOps validation for the governed documents touched by this task
- [x] T015 [US4] Run the implementation-ready verification set before opening the PR
