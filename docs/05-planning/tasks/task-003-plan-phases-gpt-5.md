---
document_id: AIDHA-TASK-003-PHASE-GPT5
owner: Ingestion Engineering Lead
status: Draft
version: "1.0"
last_updated: 2026-03-03
title: Phase Plan - GPT-5 Integration Roadmap
type: TASK
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-003-PHASE-GPT5
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 1.0
> **Last Updated:** 2026-03-03
> **Type:** TASK

# Phase Plan - GPT-5 Integration Roadmap

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 1.0     | 2026-03-03 | AI     | Initial phase plan | —         | Draft  | —         |

---

## Phase 1: Heuristic Extraction Hardening (Zero-Dependency Path)

- [ ] Task: Add heuristic quality regression test fixture in
  `packages/praecis/youtube/tests/heuristic-quality-regression.test.ts`
  - Rationale: `packages/praecis/youtube/out/dossier-final.md` shows false
    positives (intro lines) plus boundary fragments that must be pinned by CI.
  - Regression Guard: `heuristic-quality-regression.test.ts`
  - Completion Criteria: Test fails on current HeuristicClaimExtractor
    output, then passes after Phase 1 code tasks.

- [ ] Task: Implement deterministic sentence boundary splitter in
  `packages/praecis/youtube/src/extract/utils.ts`
  - Rationale: Boundary errors in dossier-final.md are driven by excerpt
    segmentation.
  - Regression Guard: `packages/praecis/youtube/tests/sentence-split.test.ts`
  - Completion Criteria: Splitter produces stable sentence arrays.

- [ ] Task: Add sentence splitter unit tests in
  `packages/praecis/youtube/tests/sentence-split.test.ts`
  - Rationale: Sentence splitting errors silently inflate fragment rate.
  - Regression Guard: `sentence-split.test.ts`
  - Completion Criteria: Tests cover comma-dangling cases.

- [ ] Task: Implement adjacent excerpt merge heuristic in
  `packages/praecis/youtube/src/extract/utils.ts`
  - Rationale: Many claims in dossier-final.md are mid-sentence shards.
  - Regression Guard: `heuristic-quality-regression.test.ts`
  - Completion Criteria: Merge joins excerpts across ≤15s gaps.

- [ ] Task: Refactor HeuristicClaimExtractor to emit sentence-level
  candidates in `packages/praecis/youtube/src/extract/claims.ts`
  - Rationale: Current 1:1 excerpt wrapping yields high fragment rate.
  - Regression Guard: `heuristic-quality-regression.test.ts`
  - Completion Criteria: Fragment rate drops below 15%.

- [ ] Task: Expand ad-read boilerplate patterns in
  `packages/praecis/youtube/src/extract/editorial-ranking.ts`
  - Rationale: Sponsor segments are false positives that pollute KG nodes.
  - Regression Guard: `editorial-metrics.test.ts`
  - Completion Criteria: CountBoilerplate() flags Wealthfront-style CTA.

- [ ] Task: Apply deterministic editor pass v2 to heuristic candidates in
  `packages/praecis/youtube/src/extract/claims.ts`
  - Rationale: FDD-003 requires deterministic quality gates.
  - Regression Guard: `heuristic-quality-regression.test.ts`
  - Completion Criteria: Heuristic output excludes boilerplate.

- [ ] Task: Replace fixed heuristic confidence with feature scoring in
  `packages/praecis/youtube/src/extract/claims.ts`
  - Rationale: Hardcoded 0.4 forces downstream ranking issues.
  - Regression Guard: `editorial-ranking.v2.test.ts`
  - Completion Criteria: Candidates with numbers score higher.

- [ ] Task: Add normalization-based dedupe key for heuristic candidates in
  `packages/praecis/youtube/src/extract/claims.ts`
  - Rationale: Exact-text dedupe misses trivial punctuation variants.
  - Regression Guard: `editorial-ranking.v1.test.ts`
  - Completion Criteria: Punctuation-variant candidates collapse to one.

---

## Phase 2: LLM Prompt Architecture & Context Engineering

- [ ] Task: Create Pass 1 prompt module in
  `packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`
  - Rationale: Current Pass 1 prompt is inline, creating spec drift.
  - Regression Guard: `prompt-pass1-v2.test.ts`
  - Completion Criteria: Module exports pure function returning prompt strings.

- [ ] Task: Add prompt contract tests in
  `packages/praecis/youtube/tests/prompt-pass1-v2.test.ts`
  - Rationale: Gemini baseline success depends on instruction patterns.
  - Regression Guard: `prompt-pass1-v2.test.ts`
  - Completion Criteria: Tests assert presence of required constraints.

- [ ] Task: Wire promptVersion routing to v2 module in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Cache determinism depends on promptVersion coupling.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Switching promptVersion changes cache keys.

- [ ] Task: Encode Gemini-derived few-shot exemplars in
  `packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`
  - Rationale: Gemini shows high-resolution claim style outperforms generic.
  - Regression Guard: `prompt-pass1-v2.test.ts`
  - Completion Criteria: Prompt includes at least 3 positive exemplars.

- [ ] Task: Encode Gemini-derived negative exemplars in
  `packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`
  - Rationale: Heuristic-like transcript echoes are recurring false positives.
  - Regression Guard: `prompt-pass1-v2.test.ts`
  - Completion Criteria: Prompt contains explicit reject examples.

- [ ] Task: Add evidenceType field to claim candidate interface in
  `packages/praecis/youtube/src/extract/types.ts`
  - Rationale: Gemini baseline includes evidence basis improving auditability.
  - Regression Guard: `schema.test.ts`
  - Completion Criteria: TypeScript build succeeds with optional field.

- [ ] Task: Extend Pass 1 JSON parsing schema for evidenceType in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Without parsing, prompt improvements cannot propagate.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Cached payload round-trips with evidenceType.

- [ ] Task: Add parse-error feedback into strict retry prompt in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Current retry only says Return ONLY valid JSON.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Retry includes bounded validation error summary.

- [ ] Task: Increase Pass 1 max token budget override in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: JSON truncation yields empty parses triggering fallback.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Stub client observes maxTokens set.

- [ ] Task: Add OpenAI-compatible structured output option in
  `packages/praecis/youtube/src/extract/llm-client.ts`
  - Rationale: Provider-supported JSON schema reduces parse failures.
  - Regression Guard: `llm-client.test.ts`
  - Completion Criteria: Request body includes response_format.

---

## Phase 3: Multi-Pass Pipeline Orchestration

- [ ] Task: Derive startSeconds exclusively from cited excerpt IDs in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: FDD-002 requires temporal anchors be provenance-derived.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Mismatched timestamp clamped to earliest excerpt.

- [ ] Task: Add fallback provenance marker field to candidates in
  `packages/praecis/youtube/src/extract/types.ts`
  - Rationale: Fallback is only logged, not persisted for diagnostics.
  - Regression Guard: `diagnose.test.ts`
  - Completion Criteria: Candidate type supports additive marker.

- [ ] Task: Persist fallback marker into claim node metadata in
  `packages/praecis/youtube/src/extract/claims.ts`
  - Rationale: Silent degradation creates low-quality pipelines.
  - Regression Guard: `extraction.test.ts`
  - Completion Criteria: Claims include metadata flag.

- [ ] Task: Add context-dependent claim penalty in
  `packages/praecis/youtube/src/extract/editorial-ranking.ts`
  - Rationale: Pronoun-led fragments violate FDD-003 requirements.
  - Regression Guard: `editorial-ranking.v2.test.ts`
  - Completion Criteria: Pronoun-led candidates score lower.

- [ ] Task: Add transcript-echo penalty hook in
  `packages/praecis/youtube/src/extract/editorial-ranking.ts`
  - Rationale: LLM Pass 1 returns transcript paraphrase without density.
  - Regression Guard: `editorial-ranking.v2.test.ts`
  - Completion Criteria: Echo candidates deprioritized.

- [ ] Task: Extend transcript segment schema with optional speaker field in
  `packages/praecis/youtube/src/schema/transcript.ts`
  - Rationale: Speaker attribution is currently impossible.
  - Regression Guard: `schema.test.ts`
  - Completion Criteria: Zod schema validates both formats.

- [ ] Task: Implement speaker prefix parsing in
  `packages/praecis/youtube/src/client/transcript.ts`
  - Rationale: Attribution failures propagate into downstream claims.
  - Regression Guard: `transcript-parse.test.ts`
  - Completion Criteria: Parser extracts speaker without altering timestamps.

- [ ] Task: Persist excerpt speaker metadata in
  `packages/praecis/youtube/src/pipeline/ingest.ts`
  - Rationale: Pass 1 chunk mining cannot preserve speaker provenance.
  - Regression Guard: `pipeline.test.ts`
  - Completion Criteria: Stored Excerpt nodes include speaker.

- [ ] Task: Include speaker field in Pass 1 excerpt payload in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Pass 1 must preserve provenance fields.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Prompt excerpt JSON includes speaker.

---

## Phase 4: Validation & Benchmarking Infrastructure

- [ ] Task: Expand Vitest include globs for .spec.ts in
  `packages/praecis/youtube/vitest.config.ts`
  - Rationale: Benchmark enforcement must be discoverable by CI.
  - Regression Guard: `vitest.config.ts`
  - Completion Criteria: vitest runs both test types.

- [ ] Task: Add extraction benchmark harness test in
  `packages/praecis/youtube/tests/extract/benchmark.spec.ts`
  - Rationale: Success criteria requires CI failure on quality regression.
  - Regression Guard: `benchmark.spec.ts`
  - Completion Criteria: Test computes precision proxies with thresholds.

- [ ] Task: Create labeled golden dataset file in
  `packages/praecis/youtube/tests/fixtures/extraction-golden/h_1zlead9ZU.samples.json`
  - Rationale: Concrete failure strings can be labeled for detection.
  - Regression Guard: `golden-dataset.spec.ts`
  - Completion Criteria: Dataset contains ≥50 labeled samples.

- [ ] Task: Add golden dataset integrity test in
  `packages/praecis/youtube/tests/extract/golden-dataset.spec.ts`
  - Rationale: Fixture drift breaks benchmarks.
  - Regression Guard: `golden-dataset.spec.ts`
  - Completion Criteria: Test asserts minimum sample count.

- [ ] Task: Add dossier markdown parser utility in
  `packages/praecis/youtube/src/diagnose/benchmark-extraction.ts`
  - Rationale: Benchmarks must execute against out/ artifacts.
  - Regression Guard: `benchmark.spec.ts`
  - Completion Criteria: Parser extracts claim text deterministically.

- [ ] Task: Add baseline metric snapshot file in
  `packages/praecis/youtube/tests/fixtures/extraction-golden/baseline-metrics.json`
  - Rationale: Fixed baseline prevents moving goalposts.
  - Regression Guard: `benchmark.spec.ts`
  - Completion Criteria: Benchmark fails if metrics exceed baseline.

- [ ] Task: Add end-to-end extraction quality test for heuristic path in
  `packages/praecis/youtube/tests/extract/heuristic-benchmark.spec.ts`
  - Rationale: Zero-config must remain usable.
  - Regression Guard: `heuristic-benchmark.spec.ts`
  - Completion Criteria: Heuristic achieves ≥40% improvement.

---

## Phase 5: Pre-Mortem Risk Mitigations (Anti-Fragility)

- [ ] Task: Implement circuit breaker state machine in
  `packages/praecis/youtube/src/extract/circuit-breaker.ts`
  - Rationale: Latency regression can stall batch ingestion.
  - Regression Guard: `circuit-breaker.spec.ts`
  - Completion Criteria: Breaker opens after N failures.

- [ ] Task: Enforce circuit breaker usage for chunk mining in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Failed runs should terminate early with degraded mode.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: After breaker opens, remaining chunks skip LLM.

- [ ] Task: Implement token budget estimator in
  `packages/praecis/youtube/src/extract/token-budget.ts`
  - Rationale: Cost explosion risk rises with long transcripts.
  - Regression Guard: `token-budget.spec.ts`
  - Completion Criteria: Estimator returns stable upper bounds.

- [ ] Task: Apply token budget chunk truncation in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Unbounded payloads increase truncation risk.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Excerpt payload truncated deterministically.

- [ ] Task: Add cache format version field in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Cache invalidation failures silently reuse stale data.
  - Regression Guard: `llm-claims.test.ts`
  - Completion Criteria: Reader accepts legacy cache without version.

- [ ] Task: Centralize claim candidate runtime schema in
  `packages/praecis/youtube/src/extract/claim-candidate-schema.ts`
  - Rationale: Schema drift causes downstream consumer breakage.
  - Regression Guard: `claim-candidate-schema.spec.ts`
  - Completion Criteria: Both candidates validate under one schema.

- [ ] Task: Implement lexical grounding verifier in
  `packages/praecis/youtube/src/extract/verification.ts`
  - Rationale: Hallucinated claims are catastrophic for KG integrity.
  - Regression Guard: `verification.spec.ts`
  - Completion Criteria: Verifier rejects low overlap candidates.

- [ ] Task: Enforce grounding verifier filtering for Pass 1 output in
  `packages/praecis/youtube/src/extract/llm-claims.ts`
  - Rationale: Frontier LLMs can over-extract.
  - Regression Guard: `benchmark.spec.ts`
  - Completion Criteria: Benchmark measures hallucination below 5%.
