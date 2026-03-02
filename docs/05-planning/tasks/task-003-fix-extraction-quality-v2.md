# YouTube Video Claim Extraction Quality Improvement Task Breakdown

## Pre-Mortem Analysis
**Likely Failure Points:**
1. **Over-reliance on LLM prompts without testing:** Failing to validate prompt changes with real-world test cases
2. **Ignoring heuristic fallback quality:** Assuming LLM extraction will always work, leading to poor out-of-box experience
3. **Lack of validation metrics:** Not measuring extraction quality against a stable baseline
4. **Breaking backward compatibility:** Changing existing functionality without testing cached results
5. **Insufficient prompt versioning:** Failing to properly version prompts, leading to cache inconsistencies

**Mitigation Strategies:**
- Always test prompt changes against golden fixtures
- Improve heuristic extractor as a reliable fallback
- Implement objective quality metrics (metadata coverage, fragment rate, etc.)
- Maintain compatibility with existing cache formats
- Strict prompt versioning with clear documentation

## Phase 1: Heuristic Extractor Improvements (Zero-Config Quality)

### Task List
- [ ] **1.1 Add deterministic sentence splitter helper** (`packages/praecis/youtube/src/extract/utils.ts`, `packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: Replace raw excerpt wrapping with proper sentence splitting to produce standalone claims.
- [ ] **1.2 Split excerpts into sentence-level candidates** (`packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Eliminate "dangling clause" artifacts by processing complete sentences.
- [ ] **1.3 Merge adjacent excerpt fragments (time-threshold merge)** (`packages/praecis/youtube/src/extract/claims.ts`, `packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: Fix mid-sentence transcript segmentation by merging fragments within 15 seconds.
- [ ] **1.4 Extract boilerplate filters into shared module** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Ensure consistent boilerplate filtering across all extraction paths.
- [ ] **1.5 Filter heuristic candidates before returning** (`packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Remove low-value content (sponsor messages, CTAs) from heuristic output.
- [ ] **1.6 Replace hardcoded confidence with feature-based scoring** (`packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Improve editorial ranking of heuristic candidates by scoring based on specificity (numbers, units, study terms).
- [ ] **1.7 Run deterministic editor on heuristic output (v2 by default)** (`packages/praecis/youtube/src/extract/claims.ts`, `packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: Apply editorial selection to heuristic candidates to improve quality without changing CLI.
- [ ] **1.8 Add extractorVersion metadata** (`packages/praecis/youtube/src/extract/types.ts`, `packages/praecis/youtube/src/extract/claims.ts`)
      Rationale: Version the heuristic algorithm for debugging and regression tracking.

## Phase 2: LLM Prompt Optimization (Pass 1 Quality)

### Task List
- [ ] **2.1 Extract Pass 1 prompt into versioned module** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Enable prompt iteration with version control and cache determinism.
- [ ] **2.2 Add positive examples from Gemini baseline** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Communicate target "high-resolution" style using proven examples.
- [ ] **2.3 Add negative examples (anti-patterns) to reject** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Reduce transcript-echo and generic claims by showing what to avoid.
- [ ] **2.4 Strengthen schema constraints in prompt** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Explicitly require standalone sentences without transcript artifacts.
- [ ] **2.5 Inject video-level context into chunk prompts** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Improve claim contextualization by including video title, channel, and description.
- [ ] **2.6 Add evidenceType field to claim schema** (`packages/praecis/youtube/src/extract/types.ts`)
      Rationale: Enable evidence-grounded claims (RCT, meta-analysis, expert opinion).
- [ ] **2.7 Parse and persist evidenceType from LLM output** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Capture evidence type information for ranking and auditability.
- [ ] **2.8 Render evidenceType in dossier output** (`packages/praecis/youtube/src/export/dossier.ts`, `packages/praecis/youtube/src/export/types.ts`)
      Rationale: Make evidence type visible in the final artifact.
- [ ] **2.9 Increase claim mining token budget** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/extract/llm-client.ts`)
      Rationale: Prevent JSON truncation for 10-minute chunks by increasing maxTokens to 3000.
- [ ] **2.10 Add provider-safe structured output support** (`packages/praecis/youtube/src/extract/llm-client.ts`, `packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Reduce parse failures using JSON schema validation where supported.
- [ ] **2.11 Add parse-error-aware retries** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Improve retry success rates by including validation errors in retry prompts.
- [ ] **2.12 Make fallback explicit in diagnostics** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/diagnose/index.ts`)
      Rationale: Avoid silent degradation by clearly marking heuristic fallback in output.
- [ ] **2.13 Normalize classification and type values** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/extract/types.ts`)
      Rationale: Ensure consistent metadata values across extraction runs.
- [ ] **2.14 Add constraints to avoid pronoun-only claims** (`packages/praecis/youtube/src/extract/prompts/pass1-claim-mining-v2.ts`)
      Rationale: Reduce context-dependent claims by banning pronoun-led sentences without clear antecedents.

## Phase 3: Editorial Pass Enhancements (Pass 2 Quality)

### Task List
- [ ] **3.1 Move tokenization/similarity helpers to shared utils** (`packages/praecis/youtube/src/extract/utils.ts`, `packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: Keep editorial pass reusable and independent of Pass 1 implementation.
- [ ] **3.2 Add semantic-similarity dedupe** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts`)
      Rationale: Catch paraphrased claims that have different excerpt IDs.
- [ ] **3.3 Add metadata richness bonus in scoring** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: Prefer claims with domain, classification, and evidence type metadata.
- [ ] **3.4 Add transcript-echo detection** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`)
      Rationale: Penalize claims that are identical to raw excerpts.
- [ ] **3.5 Expose editorial diagnostics in CLI/JSON** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/src/cli.ts`, `packages/praecis/youtube/src/diagnose/index.ts`)
      Rationale: Provide actionable feedback on claim selection decisions.
- [ ] **3.6 Make v2 editor default (keep v1 for compatibility)** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/src/cli/help.ts`)
      Rationale: Deliver improved quality to all users while preserving backwards behavior.
- [ ] **3.7 Add context-dependent claim penalty** (`packages/praecis/youtube/src/extract/editorial-ranking.ts`, `packages/praecis/youtube/tests/editorial-ranking.v2.test.ts`)
      Rationale: Penalize pronoun-led claims that lack context.

## Phase 4: Validation & Benchmarking

### Task List
- [ ] **4.1 Create CC-licensed benchmark video fixtures** (`testdata/youtube_golden/README.md`, `packages/praecis/youtube/ops/capture-golden-fixtures.sh`)
      Rationale: Establish a reproducible quality testing baseline.
- [ ] **4.2 Create golden claim fixture for benchmark video** (`packages/praecis/youtube/tests/fixtures/claims-golden.json`, `packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: Define expected high-quality claims for regression testing.
- [ ] **4.3 Add heuristic quality regression tests** (`packages/praecis/youtube/tests/extraction.test.ts`)
      Rationale: Ensure heuristic improvements don't regress to raw fragments.
- [ ] **4.4 Add Pass 1 cache-compatibility tests** (`packages/praecis/youtube/tests/llm-claims.test.ts`)
      Rationale: Verify additive schema changes don't break existing cache reads.
- [ ] **4.5 Create extraction benchmarking harness** (`packages/praecis/youtube/src/diagnose/benchmark-extraction.ts`, `packages/praecis/youtube/src/diagnose/index.ts`)
      Rationale: Measure quality metrics (metadata coverage, fragment rate, etc.) automatically.
- [ ] **4.6 Add end-to-end extraction → dossier test** (`packages/praecis/youtube/tests/cli.test.ts`, `packages/praecis/youtube/tests/dossier.test.ts`)
      Rationale: Ensure the full pipeline works correctly on golden fixtures.
- [ ] **4.7 Document prompt versioning and cache invalidation policy** (`docs/30-fdd/fdd-002-first-pass-youtube-claim-mining.md`, `packages/praecis/youtube/src/cli/help.ts`)
      Rationale: Prevent cache inconsistencies by documenting prompt iteration workflow.

## Phase 5: Optional LLM Rewrite Pass (Pass 2b)

### Task List
- [ ] **5.1 Create versioned rewrite prompt module** (`packages/praecis/youtube/src/extract/prompts/editor-rewrite-v3.ts`)
      Rationale: Improve rewrite quality with examples and version control.
- [ ] **5.2 Increase rewrite token budget** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Prevent truncation when rewriting large claim sets.
- [ ] **5.3 Re-tune rewrite guardrails with tests** (`packages/praecis/youtube/src/extract/llm-claims.ts`, `packages/praecis/youtube/tests/llm-claims.test.ts`)
      Rationale: Optimize guardrails to prevent hallucination while allowing specificity.
- [ ] **5.4 Add evidence-type preservation guardrail** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Ensure rewrites preserve evidence type information.

## Phase 6: Documentation & Maintenance

### Task List
- [ ] **6.1 Update FDD-002 candidate schema examples** (`docs/30-fdd/fdd-002-first-pass-youtube-claim-mining.md`)
      Rationale: Sync FDD with current implementation.
- [ ] **6.2 Update FDD-003 editorial scoring rules** (`docs/30-fdd/fdd-003-second-pass-editorial-selection.md`)
      Rationale: Document V2 scoring formula and semantic dedupe algorithm.
- [ ] **6.3 Remove dead imports and scaffolding** (`packages/praecis/youtube/src/extract/llm-claims.ts`)
      Rationale: Keep codebase tidy and prevent accidental reintroduction of abandoned paths.
- [ ] **6.4 Archive legacy output artifacts** (`packages/praecis/youtube/out/`)
      Rationale: Avoid confusion by labeling old heuristic-only outputs.

## Success Criteria

The extraction quality improvement will be considered successful when:
1. **Zero-config experience produces usable output** (heuristic + V2 editorial)
2. **LLM extraction matches Gemini baseline quality** on golden fixtures
3. **Domain coverage exceeds 70%** across extracted claims
4. **Evidence type coverage exceeds 60%** for LLM-extracted claims
5. **Fragment rate drops below 15%** (from ~80%)
6. **Standalone claim rate exceeds 85%** (from ~40%)
7. **All new code has test coverage** as specified in the task list
8. **Backward compatibility maintained** - existing caches and CLI commands work unchanged

## Critical Path for MVP Quality

1. **Phase 2.1-2.5** (Prompt optimization) - Highest impact on LLM extraction quality
2. **Phase 3.1-3.4** (V2 scoring improvements) - Enables better candidate selection
3. **Phase 1.1-1.7** (Heuristic improvements) - Ensures fallback is not garbage
4. **Phase 4.1-4.2** (Validation fixtures) - Prevents regressions