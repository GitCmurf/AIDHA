---
document_id: AIDHA-TASK-003
owner: Ingestion Team
status: Superseded
version: "0.4"
last_updated: 2026-03-02
title: Fix Extraction Quality and Provider Flex
type: TASK
docops_version: "2.0"
---

**This task has been superseded by the detailed breakdown in `task-003-fix-extraction-quality-v2.md`.**

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-003
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-03-02
> **Type:** TASK

# Fix Extraction Quality and Provider Flex

## Version History

| Version | Date       | Author | Change Summary                                                          | Reviewers | Status | Reference        |
| :------ | :--------- | :----- | :---------------------------------------------------------------------- | :-------- | :----- | :--------------- |
| 0.1     | 2026-03-01 | AI     | Initial task plan based on workplan results.                            | —         | Draft  | —                |
| 0.2     | 2026-03-01 | AI     | Align with FDD-004 (Profile-based configuration).                       | —         | Draft  | FDD-004          |
| 0.3     | 2026-03-02 | AI     | Comprehensive atomic task breakdown for extraction quality improvement. | —         | Draft  | FDD-002, FDD-003 |
| 0.4     | 2026-03-02 | AI     | Rewrite task list to be fully atomic and align with current code paths. | —         | Draft  | FDD-002, FDD-003 |

## 1. Background and Work to Date

### 1.1 Initial Observed Failures

Early attempts to extract high-quality claims from video `h_1zlead9ZU` revealed several systemic
weaknesses:

- **Silent Fallbacks:** The `LlmClaimExtractor` was silently falling back to the
  `HeuristicClaimExtractor` when LLM calls failed (e.g., due to 401 Unauthorized errors) or when the
  LLM produced invalid/empty JSON. Even when a warning is logged, this can be easy to miss and
  results in dossiers containing low-utility fragments like "in the fields of fitness and
  nutrition" instead of semantic assertions.
- **Credential Confusion:** Ambiguity in the configuration hierarchy led to extraction runs being
  executed without valid API keys, even when the system reported a redacted "**\*\*\*\***" key (which
  was a default placeholder in some views).
- **Cache Pollution:** Use of `prompt-version v1` across multiple iterations caused the system to
  report `noop=20` (cache hits) even when logic had changed, masking the fact that the LLM was not
  actually being re-queried.

### 1.2 The "Senior Analyst" Mock Test

To establish a "Goal State" without being blocked by API credentials, a high-resolution mock test
was implemented:

- **Upgraded Schema:** Added `Domain` (e.g., Protein Kinetics) and `Classification`
  (Fact/Mechanism/Opinion) to the graph metadata and dossier rendering.
- **Proven Potential:** By manually injecting the high-resolution extracts (matching Gemini-web
  portal output) into a `MockAnalyst`, we verified that the AIDHA graph and dossier pipeline is
  capable of handling and displaying extremely high-utility information.

### 1.3 Architectural Realignment (FDD-004)

Following the initial fixes, the configuration strategy was realigned with **AIDHA-FDD-004**:

- Moved behavioral parameters (model, reasoning effort) from environment variables to **Profiles**.
- Reserved `.env` strictly for secrets (API keys).
- Hardcoded `gpt-5-mini` as the **Tier 5 fallback** to ensure zero-config functionality while
  encouraging profile use for advanced features.

## 2. Technical Objectives

- Support the **GPT-5 model family** (`gpt-5-mini`, `gpt-5-nano`, `gpt-5.2`).
- Implement **"Thinking Mode"** configurability via the `reasoning_effort` API parameter.
- Enable seamless switching between providers (OpenAI, Google, z.AI, Xiaomi, OpenRouter) using the
  "nearest to task" configuration hierarchy.
- Default the system to `gpt-5-mini` (replacing the deprecated `4o-mini`).
- **Dramatically improve extraction quality** to match the Gemini 3.1 Pro baseline
  (`out/gemini-web-claims-extraction.md`).

## 3. Quality Gap Analysis

### Current vs. Goal State

| Dimension                 | Current (Heuristic Fallback)          | Current (LLM Path)                | Goal (Gemini-web Baseline)                        |
| :------------------------ | :------------------------------------ | :-------------------------------- | :------------------------------------------------ |
| **Claim Text**            | Raw transcript fragments              | Basic assertions (often generic)  | Specific, self-contained physiological assertions |
| **Domain Tag**            | Missing                               | Present but coarse                | Fine-grained (e.g. "Protein Kinetics")            |
| **Classification**        | Missing                               | Present but inconsistent          | Fact / Mechanism / Opinion with evidence type     |
| **Confidence / Evidence** | Hardcoded 0.40                        | LLM-assigned 0.7 default          | Evidence-grounded (RCT, Meta-analysis, etc.)      |
| **Boilerplate Filtering** | Transcript-level noise passes through | Some filtered in editorial pass   | Zero boilerplate                                  |
| **Claim Count / Video**   | ~15-25 low-value fragments            | ~5-12 per chunk, variable quality | 15-25 high-utility assertions                     |
| **Provenance**            | 1:1 excerpt mapping                   | Excerpt IDs preserved             | Timestamp + evidence citation                     |

### Root Causes

1. **Heuristic extractor** does zero semantic analysis — it simply wraps raw excerpt text.
2. **LLM system prompt** lacks structured output guidance (few-shot examples, negative examples).
3. **Chunk context is too narrow** — each chunk is processed in isolation without video-level context.
4. **Editorial pass** optimizes for diversity/dedup but cannot rescue low-quality input candidates.
5. **Fallback hides upstream failure** — when LLM calls fail (or parse fails), heuristic fallback can
   make outputs look “successful” while actually being low-signal transcript fragments.
6. **Token budgets are underspecified** — Pass 1 claim mining currently relies on a low default
   `max_tokens` (900), which is frequently insufficient for strict JSON + rich metadata at 10-minute
   chunk sizes.
7. **Schema is not “quality-shaped”** — the current candidate schema does not require high-utility
   fields like evidence type, and does not strongly constrain claim text away from transcript-echo.

## 4. Atomic Task List (Extraction Quality)

### Phase 1: Heuristic Improvements (Zero-Config Path)

These tasks improve zero-config extraction quality for users without LLM API keys.

- [ ] **1.1 Add a deterministic sentence splitter helper** (`packages/praecis/youtube/src/extract/utils.ts`, `packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: The current heuristic path wraps raw excerpts, producing fragments like those seen in `packages/praecis/youtube/out/dossier-v1.md`. A shared, tested splitter is the foundation for producing standalone, readable claims without requiring an LLM.
      Implementation: Add `splitSentences(text: string): string[]` using regex pattern `/[.!?]+/` with quote/parenthesis balancing.

- [ ] **1.2 Split each excerpt into sentence-level candidates** (`packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Sentence-level candidates eliminate “dangling clause” artifacts and reduce editorial noise by ensuring each candidate is syntactically complete before ranking/filtering.
      Implementation: In `HeuristicClaimExtractor.extractClaims()`, replace `flatMap(excerpt => [{ text, ... }])` with `flatMap(excerpt => splitSentences(excerpt.content).map(sentence => ({ text: sentence, ... })))`.

- [ ] **1.3 Merge adjacent excerpt fragments into single sentences (time-threshold merge)** (`packages/praecis/youtube/src/extract/claims.ts`, `packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: Transcript segmentation often splits mid-sentence; merging adjacent fragments (e.g., within 10–15 seconds) produces coherent candidates and reduces duplicate/fragmentary outputs.
      Implementation: Add post-processing step after sentence splitting that merges sentences with start time difference < 15 seconds.

- [ ] **1.4 Extract low-value/boilerplate filters into a shared module** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Reusing one boilerplate filter across heuristic and editorial passes prevents drift and stops sponsor/intro/outro content from consuming the heuristic `maxClaims` budget.
      Implementation: Export `isBoilerplate(text: string): boolean` function from the existing `LOW_VALUE_PATTERNS` array.

- [ ] **1.5 Filter heuristic candidates before returning them** (`packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: The heuristic extractor is a fallback for “out-of-box” functionality; filtering low-value patterns and obvious fragments early improves perceived quality even when no LLM is available.
      Implementation: Apply `isBoilerplate()` filter and minimum length check (>= 15 chars) after sentence splitting.

- [ ] **1.6 Replace hardcoded heuristic confidence with feature-based confidence** (`packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Even simple feature signals (numbers/units, named entities, study-like phrases) help the editorial pass rank higher-utility heuristic candidates above generic fragments.
      Implementation: Add `calculateHeuristicConfidence(text: string): number` using these features: has number/unit (+0.1), has action verb (+0.1), has study keywords (+0.05), starts with pronoun (-0.1), is question (-0.1).

- [ ] **1.7 Run the deterministic editor on heuristic output (v2 preferred)** (`packages/praecis/youtube/src/extract/claims.ts`, `packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: Pass 2 (editorial selection) is designed to be source-agnostic (`AIDHA-FDD-003`). Applying it to heuristic candidates immediately improves boilerplate removal, fragment filtering, and dedupe without changing the CLI surface.
      Implementation: In `ClaimExtractionPipeline.extractClaimsForVideo()`, when extractor is `HeuristicClaimExtractor`, wrap candidates with `runEditorPassV2()` using default v2 parameters.

- [ ] **1.8 Add `extractorVersion` metadata without changing `method` values** (`packages/praecis/youtube/src/extract/types.ts`, `packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Versioning the heuristic algorithm is necessary for debugging and for avoiding “mystery regressions”, but changing `method` values risks breaking downstream filters and existing graph metadata expectations.
      Implementation: Add `extractorVersion?: string` to `ClaimCandidate` interface and set it to `'heuristic-v1'` in `HeuristicClaimExtractor.extractClaims()`.

### Phase 2: LLM Prompt Optimization (Pass 1 — Chunk Mining)

These tasks improve the quality of LLM-extracted claims per chunk.

- [ ] **2.1 Extract the Pass 1 prompt into a versioned prompt module/file** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Prompt iteration is the fastest lever for quality, but embedding prompts directly in code encourages “tiny edits without version bumps”, which breaks cache determinism and reproducibility.
      Implementation: Create `packages/praecis/youtube/src/extract/prompts/` directory, add `getPass1Prompt()` function that returns versioned prompt object, increment `promptVersion` to `'pass1-v2'`.

- [ ] **2.2 Add few-shot positive examples from the Gemini baseline** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`, `packages/praecis/youtube/out/gemini-web-claims-extraction.md`)
      Rationale: Few-shot examples are the most direct way to communicate the target “high-resolution” style (e.g., domain-rich, evidence-typed assertions) without complex post-processing.
      Implementation: Add 2-3 examples showing: (1) Domain + Classification + Evidence pattern, (2) Specific mechanism claim with numbers/units, (3) Proper `why` justification.

- [ ] **2.3 Add few-shot negative examples (anti-patterns) to reject** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: The current prompt says “reject generic advice” but does not show what “generic” looks like, which increases transcript-echo and low-value claims.
      Implementation: Add 2 negative examples: (1) Generic advice like “eat balanced meals”, (2) Fragment “in the fields of” dangling clause.

- [ ] **2.4 Strengthen the schema contract in the prompt (text must be standalone, not transcript-echo)** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Most low-quality LLM outputs are format-correct but content-poor; explicitly shaping what “good text” looks like reduces reliance on editorial cleanup.
      Implementation: Add constraint: “Each claim MUST be a complete, standalone sentence. Do NOT include '...' or trailing clauses. Avoid claims that start with pronouns (this/that/it) without context.”

- [ ] **2.5 Inject video-level context (title, channel, description/topic) into each chunk prompt** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Processing chunks without global context causes decontextualized claims and generic summaries; the ingest pipeline already stores channel/title/description in `resource.metadata`.
      Implementation: Add `Video context: ${resource.label} by ${resource.metadata?.['channelName']}` line to prompt, include video description if available (truncate to 200 chars).

- [ ] **2.6 Add `evidenceType?: string` to claim candidates (additive schema change)** (`packages/praecis/youtube/src/extract/types.ts`)
      Rationale: The Gemini baseline explicitly grounds confidence in evidence type (RCT/meta-analysis/etc.), which materially improves utility and auditability.
      Implementation: Add `evidenceType?: string` to `ClaimCandidate` interface, allowed values: `”RCT” | “Meta-analysis” | “Cohort” | “Case Study” | “Review” | “Expert Opinion” | “Physiological Consensus” | null`.

- [ ] **2.7 Parse and persist `evidenceType` from Pass 1 output** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Additive parsing/persistence keeps backward compatibility with older caches while enabling downstream ranking and dossier rendering to prefer evidence-grounded claims.
      Implementation: In `parseResponse()`, extract `evidenceType` from candidate JSON, add to result. In `writeCache()`, include in serialized payload.

- [ ] **2.8 Render `evidenceType` in the dossier output (optional field)** (`packages/praecis/youtube/src/export/dossier.ts`, `packages/praecis/youtube/src/export/types.ts`)
      Rationale: Visibility in the primary artifact (dossier) makes it obvious when extraction is producing “Gemini-like” evidence-grounded assertions versus generic claims.
      Implementation: In `renderDossier()`, when displaying claim details, add `Evidence: ${evidenceType}` line if field exists.

- [ ] **2.9 Increase Pass 1 token budget without changing global defaults** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/extract/llm-client.ts`)
      Rationale: Raising `max_tokens` globally can have unintended consequences; setting a higher budget specifically for claim mining prevents JSON truncation while keeping other LLM calls stable.
      Implementation: Add `const CLAIM_MINING_MAX_TOKENS = 3000` constant, use in `fetchAndParseClaims()` LLM request, keep default 900 for other calls.

- [ ] **2.10 Add provider-safe structured output support (opt-in) where available** (`packages/praecis/youtube/src/extract/llm-client.ts`, `packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: JSON-mode / response-format support reduces parse failures and retries, but must be capability-gated to avoid breaking non-supporting providers.
      Implementation: Add `responseFormat?: { type: 'json_schema', jsonSchema: object }` to `LlmCompletionRequest`, conditionally include if provider supports it (e.g., OpenAI-compatible).

- [ ] **2.11 Add parse-error-aware retries (include validation failures in retry prompt)** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: The current strict retry asks for “ONLY JSON” but does not tell the model what failed; feeding back a short parse/validation error improves recovery rates without increasing temperature.
      Implementation: In retry logic, wrap error message: `JSON validation failed: ${error}. Return ONLY valid JSON matching the schema exactly.`

- [ ] **2.12 Make fallback explicit in diagnostics/output (do not silently “look successful”)** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/diagnose/index.ts`)
      Rationale: When fallback triggers, operators must see that the run is degraded; otherwise low-quality heuristic output can be mistaken for an LLM quality regression.
      Implementation: In `extractChunkClaims()`, log `console.warn` with explicit `method: 'heuristic-fallback'` metadata when falling back, add fallback `method` to candidates.

- [ ] **2.13 Normalize `classification` and `type` values during parsing** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/extract/types.ts`)
      Rationale: The prompt currently requests `Fact|Mechanism|Opinion` and a controlled `type` set, but the runtime schema accepts free strings. Normalization reduces downstream scoring drift and makes editorial selection more consistent.
      Implementation: Add `normalizeClassification(value: string): string` that maps variants to standard values, apply in `parseResponse()`. Add `normalizeType(value: string): string` for CLAIM_TYPES.

- [ ] **2.14 Add prompt constraints to avoid pronoun-only and referential claims (“this/that/it”)** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: A common failure mode is “context-dependent claims” that are not standalone; adding explicit constraints plus negative examples increases dossier usefulness without additional passes.
      Implementation: Add constraint: “Claims must be self-contained and standalone. Avoid: sentences starting with pronouns (this/that/it/they), demonstratives without context, or back-references without clear antecedents.”

### Phase 3: Editorial Pass Enhancements (Pass 2)

These tasks improve how candidates are filtered, ranked, and selected.

- [ ] **3.1 Move tokenization/similarity helpers into shared utils** (`packages/praecis/youtube/src/extract/utils.ts`, `packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: Editorial dedupe should not depend on Pass 1 implementation details; shared helpers keep Pass 2 reusable as required by `AIDHA-FDD-003`.
      Implementation: Move `tokenize()`, `numericTokens()`, and `normalizeText()` if not already shared, ensure `editorial-ranking.ts` imports from `utils.ts`.

- [ ] **3.2 Add semantic-similarity dedupe (beyond excerpt overlap)** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts`)
      Rationale: Cross-chunk duplication is common; semantic dedupe catches paraphrases that have different `excerptIds` and improves final diversity without raising the claim cap.
      Implementation: Add `semanticDedupe(candidates: ClaimCandidate[]): ClaimCandidate[]` using token overlap threshold 0.8, call before window selection.

- [ ] **3.3 Add a score bonus for rich metadata (domain/classification/evidenceType present)** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: The system should preferentially keep candidates with the same “shape” as the Gemini baseline (domain + classification + evidence), because these are higher utility and more auditable.
      Implementation: In `scoreCandidateV2()`, add bonuses: `+0.15` for domain present, `+0.1` for classification present, `+0.15` for evidenceType present.

- [ ] **3.4 Add transcript-echo detection to V2 scoring (requires excerpt text access)** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: “Claim equals excerpt” is low-value even when it’s technically a sentence; penalizing echo pushes the editor toward synthesized assertions instead of quotes.
      Implementation: Pass `excerptTextById: Map<string, number>` to scoring function, calculate `echoRatio` = text length / (excerptTexts.reduce(sum) + 1), penalize if ratio > 0.95.

- [ ] **3.5 Expose editorial diagnostics in CLI and JSON output** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/src/cli.ts`, `packages/praecis/youtube/src/diagnose/index.ts`)
      Rationale: Operators need to see drop reasons, coverage, and dedupe counts to iterate quickly; without diagnostics, “quality” changes are hard to attribute to pass 1 vs pass 2.
      Implementation: Return `EditorialDiagnostics` from editorial passes, log with `aidha diagnose extraction` command, add `--show-editorial-diagnostics` flag.

- [ ] **3.6 Make `v2` the default editor version (keep `v1` flag for compatibility)** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/cli/help.ts`)
      Rationale: V2 scoring is designed to prefer specificity/actionability and reduce fragments; keeping `v1` opt-in preserves backwards behavior for debugging and regression comparisons.
      Implementation: Change `DEFAULT_EDITOR_VERSION` to `’v2’`, add `--editor-v1` flag option for backwards compatibility.

- [ ] **3.7 Add a “standalone claim” penalty (pronoun-led / missing subject) in V2 scoring** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts`)
      Rationale: Even after prompt improvements, some claims remain context-dependent; a deterministic penalty prevents these from displacing high-utility assertions in the final capped set.
      Implementation: Add function `isContextDependent(text: string): boolean` that checks for leading pronouns (“This/That/It”), add `-0.15` penalty in `scoreCandidateV2()`.

### Phase 4: Validation & Benchmarking (Quality Gates)

- [ ] **4.1 Select a CC-licensed “quality benchmark” video and capture transcript fixtures** (`testdata/youtube_golden/README.md`, `packages/praecis/youtube/ops/capture-golden-fixtures.sh`)
      Rationale: Public, reproducible quality testing requires redistributable transcript fixtures; relying on `h_1zlead9ZU` outputs can create licensing/reproducibility risk.
      Implementation: Find a CC-BY video 5-10 minutes long in health/fitness space, create `testdata/youtube_golden/` directory with transcript and expected claims.

- [ ] **4.2 Add a claim-quality golden fixture derived from the benchmark video** (`packages/praecis/youtube/tests/fixtures/claims-golden.json`, `packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: A stable target set is required to prevent regressions and to validate that prompt/editor changes actually improve claim utility over time.
      Implementation: Create fixture with 15-25 high-utility claims in `ClaimCandidate[]` format, add test that asserts extraction contains at least 50% of golden claims.

- [ ] **4.3 Add heuristic quality regression tests (sentence completeness, boilerplate removal, min length)** (`packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: Heuristic extraction is the out-of-box experience; tests ensure improvements don’t regress back to raw fragments and sponsor/CTA noise.
      Implementation: Add test suite covering: sentence splitter completeness, boilerplate filter effectiveness, minimum length enforcement, feature-based confidence calculation.

- [ ] **4.4 Add Pass 1 cache-compatibility tests for additive schema changes** (`packages/praecis/youtube/tests/llm-claims.test.ts`)
      Rationale: Adding optional fields (e.g., `evidenceType`) must not break reads of existing cache files; compatibility tests protect upgrades in-place.
      Implementation: Write test that loads cache with old schema, verifies `ClaimSchema.parse()` passes, checks new fields are defaulted/undefined.

- [ ] **4.5 Add extraction benchmarking harness (metrics + diff report)** (`packages/praecis/youtube/src/diagnose/benchmark-extraction.ts`, `packages/praecis/youtube/src/diagnose/index.ts`)
      Rationale: Automated metrics (duplicate rate, boilerplate rate, metadata coverage) make prompt/editor iteration measurable without subjective manual review.
      Implementation: Add `benchmarkExtractionResults(results: ClaimCandidate[]): ExtractionMetrics` function calculating: metadata coverage (% with domain/classification/evidenceType), fragment rate (< 15 chars), duplicate rate, boilerplate rate.

- [ ] **4.6 Add an end-to-end CLI verification script for “claims → dossier” on fixtures** (`packages/praecis/youtube/tests/cli.test.ts`, `packages/praecis/youtube/tests/dossier.test.ts`)
      Rationale: Quality work must not break CLI commands or dossier rendering; a fixture-driven e2e test ensures compatibility while allowing output improvements.
      Implementation: Add `test.cli.extractionToDossierWorkflow()` test that runs full pipeline on golden video and verifies dossier output is valid.

- [ ] **4.7 Document the prompt-version bump policy and cache invalidation expectations** (`docs/30-fdd/fdd-002-first-pass-youtube-claim-mining.md`, `packages/praecis/youtube/src/cli/help.ts`)
      Rationale: Prompt changes without version bumps create irreproducible “cache-hit” behavior; documentation makes the workflow explicit for contributors.
      Implementation: Add section to FDD-002 explaining prompt versioning policy: increment `promptVersion` when prompt changes, cache invalidation rules, testing requirements.

### Phase 5: Optional LLM Rewrite Pass (Pass 2b)

These tasks improve the optional editorial rewrite pass (`--editor-llm`).

- [ ] **5.1 Create versioned rewrite prompt module** (`packages/praecis/youtube/src/extract/prompts/editor-rewrite-v3.ts`)
      Rationale: Rewrite quality depends heavily on examples; embedding prompts in code encourages “tiny edits without version bumps” which breaks cache determinism.
      Implementation: Create `getEditorRewritePrompt()` function, increment version to `'editor-rewrite-v3'`, add 2-3 examples: (1) Adding specificity to generic claim, (2) Preserving evidence-type and numbers, (3) Shortening wordy claim while keeping meaning.

- [ ] **5.2 Increase rewrite `maxTokens` to avoid JSON truncation** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: The rewrite request processes many claims at once; insufficient output tokens leads to truncation and parse failure, effectively disabling rewrite improvements.
      Implementation: Change `maxTokens: 2000` to `maxTokens: 4000` in `fetchRewriteCandidates()` LLM request.

- [ ] **5.3 Re-tune rewrite guardrails (edit-ratio cap) using fixture-driven tests** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/tests/llm-claims.test.ts`)
      Rationale: Guardrails should prevent hallucination while permitting meaningful specificity increases; tests ensure the thresholds are intentional and stable.
      Implementation: Add test `test.rewriteGuardrails()` that sends claims through rewrite and verifies: (1) Hallucination check passes, (2) Edit ratio doesn't exceed threshold, (3) Numeric tokens preserved.

- [ ] **5.4 Add evidence-type preservation guardrail for rewrites** (`packages/praecis/youtube/src/extract/llmclaims.ts`)
      Rationale: Evidence type is a primary utility signal; rewrites that drop it reduce auditability and can turn high-signal claims into generic ones.
      Implementation: In `rewriteSelectedClaims()`, verify rewritten claims preserve `evidenceType` if present in original, return original claim if evidence type is lost.

### Phase 6: Documentation & Maintenance

- [ ] **6.1 Update FDD-002 candidate schema examples (additive fields only)** (`docs/30-fdd/fdd-002-first-pass-youtube-claim-mining.md`)
      Rationale: The FDD is the contract for pass 1; keeping it in sync prevents future drift and clarifies which fields are required vs optional for backward compatibility.
      Implementation: Add `evidenceType?: string` to schema example, update schema table to show it as optional additive field.

- [ ] **6.2 Update FDD-003 editorial scoring/dedupe rules to match implementation** (`docs/30-fdd/fdd-003-second-pass-editorial-selection.md`)
      Rationale: Pass 2 is intended to be deterministic and reusable; documenting the exact rules makes quality work reviewable and reduces “mystery scoring”.
      Implementation: Document V2 scoring formula with all weights and penalties, describe semantic dedupe algorithm, include example with score calculation.

- [ ] **6.3 Remove dead imports and prompt/test scaffolding that is no longer used** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Extraction quality work will iterate quickly; keeping the implementation tidy prevents accidental reintroduction of abandoned mock paths.
      Implementation: Run `eslint --fix` and `tslint --fix`, remove unused imports, delete any mock/test scaffolding that predates current implementation.

- [ ] **6.4 Archive or label legacy output artifacts to avoid confusion during benchmarking** (`packages/praecis/youtube/out/`)
      Rationale: Old heuristic-only dossiers can be mistaken for “current behavior”; clarifying or archiving outputs keeps benchmark comparisons honest.
      Implementation: Create `packages/praecis/youtube/out/README.md` documenting output artifacts with: name, date, extraction method, quality notes. Rename legacy files with `-legacy` suffix.

---

## 5. Test Coverage Requirements

To ensure all extraction quality improvements are properly validated, the following test coverage is required:

### 5.1 Unit Tests

| Component | Test File | Coverage Requirements |
|-----------|-----------|----------------------|
| Sentence splitter | `packages/praecis/youtube/tests/extraction.test.ts` | Test edge cases: empty input, single sentence, quotes, multiple sentences, malformed input |
| Boilerplate filter | `packages/praecis/youtube/tests/extraction.test.ts` | Test: sponsor messages, CTA phrases, intro/outro patterns, edge cases |
| Feature-based confidence | `packages/praecis/youtube/tests/extraction.test.ts` | Test: numbers/units (+0.1), action verbs (+0.1), pronoun-start (-0.1), questions (-0.1) |
| Heuristic extraction | `packages/praecis/youtube/tests/extraction.test.ts` | End-to-end: raw excerpts → sentence-split → filtered → deduped candidates |
| Prompt parsing | `packages/praecis/youtube/tests/llm-claims.test.ts` | Test: prompt extraction, schema parsing, normalization, cache compatibility |
| Editorial V2 scoring | `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts` | Test: semantic dedupe, metadata bonus, transcript-echo detection, standalone penalties |
| Rewrite guardrails | `packages/praecis/youtube/tests/llm-claims.test.ts` | Test: hallucination check, edit-ratio cap, numeric token preservation, evidence-type preservation |

### 5.2 Integration Tests

| Feature | Test File | Coverage Requirements |
|---------|-----------|----------------------|
| E2E extraction pipeline | `packages/praecis/youtube/tests/integration.test.ts` | Test: transcript → claims → graph → dossier on golden fixtures |
| CLI extraction commands | `packages/praecis/youtube/tests/cli.test.ts` | Test: `aidha extract`, `aidha dossier` with various flags |
| Benchmark comparison | `packages/praecis/youtube/src/diagnose/benchmark-extraction.test.ts` | Test: metrics calculation, diff report generation, baseline comparison |
| Cache invalidation | `packages/praecis/youtube/tests/llm-claims.test.ts` | Test: prompt version bump, model change, transcript hash change |

### 5.3 Quality Benchmarks

**Target Metrics (based on Gemini 3.1 Pro baseline):**

| Metric | Current (Heuristic) | Target (LLM + V2) |
|--------|----------------------|-------------------|
| Domain coverage | 0% | > 80% |
| Classification coverage | 0% | > 70% |
| Evidence type coverage | 0% | > 60% |
| Fragment rate (< 15 chars) | ~80% | < 10% |
| Boilerplate rate | ~30% | < 5% |
| Standalone claim rate | ~40% | > 90% |
| Dedupe rate | N/A | > 15% (cross-chunk) |

---

## 6. Dependencies & Blocking Issues

### 6.1 Blocked by: None
All tasks can proceed in parallel. The task breakdown is organized into phases but dependencies are minimal.

### 6.2 External Dependencies
- **Gemini 3.1 Pro access**: For prompt optimization based on manual testing results (already completed)
- **CC-BY video selection**: For golden fixtures (Phase 4.1)

### 6.3 Critical Path (for MVP quality improvement)

The following tasks form the critical path for achieving MVP quality:

1. **Phase 2.1-2.5** (Prompt optimization) - Highest impact on LLM extraction quality
2. **Phase 3.1-3.4** (V2 scoring improvements) - Enables better candidate selection
3. **Phase 1.1-1.7** (Heuristic improvements) - Ensures fallback is not garbage
4. **Phase 4.1-4.2** (Validation fixtures) - Prevents regressions

---

## 7. Success Criteria

The extraction quality improvement will be considered successful when:

1. ✅ **Zero-config experience** produces usable output** (heuristic + V2 editorial)
2. ✅ **LLM extraction matches Gemini baseline quality** on golden fixtures
3. **✅ Domain coverage exceeds 70%** across extracted claims
4. ✅ **Evidence type coverage exceeds 60%** for LLM-extracted claims
5. ✅ **Fragment rate drops below 15%** (from ~80%)
6. **✅ Standalone claim rate exceeds 85%** (from ~40%)
7. ✅ **All new code has test coverage** as specified in Section 5
8. **✅ Backward compatibility maintained** - existing caches and CLI commands work unchanged
