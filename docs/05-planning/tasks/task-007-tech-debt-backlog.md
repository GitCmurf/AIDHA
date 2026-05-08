---
document_id: AIDHA-TASK-007
owner: Ingestion Engineering Lead
status: Draft
version: "1.2"
last_updated: 2026-05-07
title: Engineering Tech Debt Backlog
type: TASK
docops_version: "2.0"
area: INGEST
keywords: [tech-debt, backlog, refactoring, performance, eval]
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TASK-007
> **Owner:** Ingestion Engineering Lead
> **Status:** Draft
> **Version:** 1.2
> **Last Updated:** 2026-05-07
> **Type:** TASK

<!-- markdownlint-disable MD013 -->

# Task: Engineering Tech Debt Backlog

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 1.0     | 2026-05-01 | AI     | Initial registry; four items from eval-refinement simplify pass. | — | Draft | — |
| 1.1     | 2026-05-03 | AI     | Add deferred items from eval adversarial-review remediation batch. | — | Draft | — |
| 1.2     | 2026-05-07 | AI     | Convert WIP register into governed task backlog and add final review follow-ups. | — | Draft | — |

---

## Purpose and Scope

This governed task backlog captures known technical debt items that were identified during code
review or simplify passes but deliberately deferred because the change scope exceeded the PR
boundary, the risk-to-benefit ratio did not favour immediate action, or the fix required deeper
context than was available at review time.

Each entry is intended to be implementable as a focused follow-up PR with tests, documentation, and
validation evidence. Items are not roadmap commitments by themselves; scheduling against product
and platform milestones is the owner's responsibility.

### Governance

- **DocOps classification:** This file is a governed `TASK` document because the current repository
  standards explicitly support task files in `docs/05-planning/tasks/`. It is no longer a `WIP-`
  scratchpad and must pass scoped Meminit checks before review.
- **Ownership:** The Ingestion Engineering Lead owns triage, reassessment, and closure. Individual
  remediation PRs may assign narrower owners.
- **Review cadence:** Reassess open High-priority items before each ingestion/eval PR merges.
  Reassess Medium and Low items at least once per milestone or when touching the affected module.
- **Closure rule:** Do not delete resolved entries. Mark them `Resolved`, record the resolving
  commit or PR when available, and keep the acceptance evidence.
- **Quality bar:** A debt item is not done until code, tests, comments, docs, and CI/DocOps gates are
  aligned. If the remediation changes runtime behavior, the PR description must call it out.

### Status Model

| Status | Meaning |
|--------|---------|
| Open | Accepted debt with no active remediation PR. |
| Planned | Scoped for an upcoming PR or sprint. |
| In Progress | Active remediation branch exists. |
| Blocked | Remediation is blocked by a dependency or decision. |
| Resolved | Remediation merged or otherwise made obsolete with evidence recorded. |
| Superseded | Replaced by another backlog item, plan, ADR, or task. |

### Triage Fields

Every item should identify the affected file or subsystem, the review source, the impact of
deferral, concrete remediation steps, acceptance criteria, validation commands, and risks. Prefer a
single precise item over a broad theme unless the remediation must be architectural.

### How to Use This Registry

- **Adding an item:** Copy the item template below. Assign the next `TD-NNN` ID. Set status to
  `Open`.
- **Closing an item:** Change status to `Resolved`, add the resolving commit/PR, and record the
  date. Do not delete the entry — resolved items are a record of what was done and why.
- **Deferring further:** Add a `Deferred` note with the reason and a reassessment date.
- **Avoiding duplicates:** If a new review repeats an existing item, add a dated evidence note to
  the existing item instead of creating a duplicate.
- **Splitting items:** If an item grows beyond a reviewable PR, split it into child items and mark
  the original as `Superseded`.

### Item Template

```markdown
### TD-NNN — Title

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | High / Medium / Low |
| Category   | Performance / Maintainability / Correctness |
| Location   | `path/to/file.ts` |
| Effort     | S / M / L (days) |
| Discovered | YYYY-MM-DD, source (code review / simplify pass / etc.) |

**Problem:** …

**Impact if deferred:** …

**Remediation steps:**
1. …

**Acceptance criteria:**

- [ ] …

**Risks and caveats:** …
```

---

## Backlog Items

Items in this section may be `Open`, `Planned`, `Blocked`, or `Resolved`. Resolved entries remain
in place so future review passes can see that repeated findings were already triaged.

### TD-001 — Parallelize judge scoring in `getScoresForCell`

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | **High** |
| Category   | Performance |
| Location   | `packages/praecis/youtube/src/eval/matrix-runner.ts`, `getScoresForCell` |
| Effort     | M (1–2 days) |
| Discovered | 2026-05-01, simplify pass (efficiency review) |

**Problem:**
The judge scoring loop iterates `for (const judgeModelId of options.judgeModels)` with `await`
inside, forcing each judge model to wait for the previous one to complete before starting. Each
judge call is a network round-trip to an LLM API (typically 5–30 s). With three judge models,
the judging phase takes 3× as long as it needs to.

```typescript
// Current — serial, each judge waits for the previous
for (const judgeModelId of options.judgeModels) {
  const score = await performScoring(model.id, judgeModelId, ...);
  scores.push(score);
}
```

**Impact if deferred:**
On a 50-video × 10-model corpus (a typical eval run), judging is already the longest phase.
Serial execution means a 3-judge run takes roughly 3× the wall-clock time of the actual LLM
calls. This compounds with every additional judge model added in future.

**Remediation steps:**

1. Extract the per-judge block (cache read → dry-run branch → live score → cache write) into a
   typed helper `async function scoreForJudge(judgeModelId: string): Promise<JudgeOutcome>` where
   `JudgeOutcome = { score?: ClaimSetScore; traces: ...; usd: number; error?: string }`.
2. Replace the `for` loop with `Promise.allSettled(options.judgeModels.map(scoreForJudge))`.
3. Aggregate results: collect successful scores into `scores[]`, collect failures into
   `judgeFailures`, sum `judgeUsdEstimate`.
4. Use `Promise.allSettled` (not `Promise.all`) to preserve the existing partial-success
   behaviour — a single judge failure should not abort the other judges.
5. Verify the rate limiter (`requestRateLimiterRegistry`) is correctly keyed per judge-model so
   concurrent calls respect per-provider RPM limits. (It already is — keys are per model ID.)

**Acceptance criteria:**

- [ ] `scores[]` produced by the parallel path is identical in content (order may differ; sort
  before comparison) to the serial path for the same inputs.
- [ ] A single judge failure does not prevent other judges from completing.
- [ ] `judgeFailures` and `cellHasScoringFailure` are set correctly when one of N judges fails.
- [ ] Existing `matrix-runner.test.ts` tests continue to pass.
- [ ] Integration test or manual timing shows ≥1.8× speedup with 3 judges on a live run.

**Risks and caveats:**
Concurrent judge calls increase peak API request rate. The existing `requestRateLimiterRegistry`
handles this per-provider, but callers that set a tight `judgeMaxTokens` budget may see
concurrency-induced 429s on providers without a rate limiter configured. Ensure all judge
clients are wrapped with `wrapClientWithRateLimit`.

---

### TD-002 — Pre-index cells by videoId to eliminate N+1 filtering

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Medium |
| Category   | Performance |
| Location   | `packages/praecis/youtube/src/eval/narrow-manual-baseline.ts`, stage functions |
| Effort     | M (1 day) |
| Discovered | 2026-05-01, simplify pass (efficiency review) |

**Problem:**
Multiple stage functions (`buildVideoReports`, `judgeVideoReports`, `scoreVideoReports`, and
others) loop over `corpus.videos` and inside each iteration filter `harnessCells` and
`fallbackCells` by `videoId`:

```typescript
for (const video of corpus.videos) {
  const cells = harnessCells.filter(c => c.videoId === video.videoId); // O(N) per video
  const fallback = fallbackCells.filter(c => c.videoId === video.videoId); // O(N) per video
}
```

With V videos and C total cells this is O(V × C). For a 50-video corpus with 2,500 cells, each
stage executes ~125,000 comparisons just for filtering — across 3–4 stage functions that becomes
~500,000 comparisons.

**Impact if deferred:**
Negligible for corpora ≤ 20 videos. Noticeable (seconds of CPU overhead) for 50+ videos ×
multiple variants. The eval harness is already slow due to LLM API latency; unnecessary CPU work
adds up across iterative runs.

**Remediation steps:**

1. Build index maps once before any stage loop:

   ```typescript
   const harnessByVideoId = groupBy(harnessCells, c => c.videoId);
   const fallbackByVideoId = groupBy(fallbackCells, c => c.videoId);
   ```

   where `groupBy` is either a local utility or a one-liner:

   ```typescript
   function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
     const m = new Map<string, T[]>();
     for (const item of items) {
       const k = key(item);
       (m.get(k) ?? m.set(k, []).get(k)!).push(item);
     }
     return m;
   }
   ```

2. Replace each `.filter(c => c.videoId === video.videoId)` call with
   `harnessByVideoId.get(video.videoId) ?? []`.
3. Apply the same pattern to `manualByVideo` (already a Map in some paths — verify consistency).
4. Pass the index maps into stage functions that currently receive the raw arrays, or hoist the
   maps to the `runNarrowManualBaselineComparison` scope where all stages are orchestrated.

**Acceptance criteria:**

- [ ] All existing `narrow-manual-baseline.test.ts` tests pass.
- [ ] No `Array.filter` call with a `videoId` predicate remains inside a video iteration loop.
- [ ] A corpus of 100 videos × 5,000 cells completes stage processing with no observable
  regression in output correctness (spot-check 3 videos by comparing output JSON before/after).

**Risks and caveats:**
`narrow-manual-baseline.ts` is ~2,700 lines. Touch only the indexing — do not combine this with
other refactors in the same PR to keep the diff reviewable. Confirm that the `manualByVideo` Map
already in scope covers the same logical grouping, so it isn't duplicated.

---

### TD-003 — Extract `buildComparableClaimSets` helper

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Medium |
| Category   | Maintainability |
| Location   | `packages/praecis/youtube/src/eval/narrow-manual-baseline.ts`, `buildVideoReports` / `judgeVideoReports` / score stage |
| Effort     | S (half day) |
| Discovered | 2026-05-01, simplify pass (quality review) |

**Problem:**
The same three-part array construction — harness candidates + manual baselines + fallback
candidates — is copy-pasted verbatim in at least three stage functions:

```typescript
// Repeated in buildVideoReports, judgeVideoReports, and the score stage
const comparableClaimSets = [
  ...finalHarnessCells.filter(c => c.videoId === video.videoId)
                       .map(toHarnessComparableClaimSet("harness")),
  ...(manualByVideo.get(video.videoId) ?? []),
  ...fallbackCells.filter(c => c.videoId === video.videoId)
                  .map(toHarnessComparableClaimSet("fallback-harness", fallbackModelId)),
];
```

This block defines "the full set of comparable candidates for a video" — a semantically important
concept. If a fourth candidate source is added (e.g., a teacher-refined set), it must be added in
three places with no compile-time guarantee they stay in sync.

**Impact if deferred:**
No active bug today. The risk materialises when this block is next edited: it is easy to update
two of three copies and miss the third. The resulting subtle difference in candidate pools between
stages would produce incorrect scoring comparisons that are hard to detect without careful output
diffing.

**Remediation steps:**

1. Define a helper at module scope:

   ```typescript
   function buildComparableClaimSets(
     videoId: string,
     harnessCells: MatrixCell[],
     manualByVideo: Map<string, ComparableClaimSet[]>,
     fallbackCells: MatrixCell[],
     fallbackModelId: string
   ): ComparableClaimSet[] {
     return [
       ...harnessCells.filter(c => c.videoId === videoId)
                      .map(toHarnessComparableClaimSet("harness")),
       ...(manualByVideo.get(videoId) ?? []),
       ...fallbackCells.filter(c => c.videoId === videoId)
                       .map(toHarnessComparableClaimSet("fallback-harness", fallbackModelId)),
     ];
   }
   ```

2. Replace all three copy-paste call sites with `buildComparableClaimSets(video.videoId, ...)`.
3. If TD-002 (pre-indexing) is implemented first, accept pre-indexed maps instead of raw arrays
   to avoid redundant filtering.

**Acceptance criteria:**

- [ ] The word `comparableClaimSets` appears at the construction site exactly once in the file
  (in the helper body).
- [ ] All existing tests pass.
- [ ] Output of a full narrow baseline run is byte-identical before and after (run with
  `--resume` disabled to force full recomputation).

**Risks and caveats:**
Carefully verify all three call sites use the same `fallbackModelId` and `manualByVideo` source —
if they differ in any subtle way, the helper must be parameterised to accommodate that, not forced
to unify a real difference. Read all three sites before writing the helper signature.

Note: TD-002 and TD-003 are independent but compose well — do TD-002 first to eliminate the
repeated `.filter()` calls, then TD-003 to unify the overall construction.

---

### TD-004 — Collapse provider config getter functions into a factory

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | Maintainability |
| Location   | `packages/praecis/youtube/src/cli-eval.ts`, `getOpenAiConfig` / `getZaiConfig` / `getXiaomiConfig` and similar |
| Effort     | S (2–4 hours) |
| Discovered | 2026-05-01, simplify pass (quality review) |

**Problem:**
Multiple provider config getter functions share an identical structure: look up an env var for
the API key, compute an `effectiveBaseUrl` (env override or default), and return a typed config
object. The functions differ only in which env vars they read and what the default base URL is.

```typescript
// All of these have the same shape:
const getOpenAiConfig = (): ProviderConfig | number => { ... };
const getZaiConfig = (): ProviderConfig | number => { ... };
const getXiaomiConfig = (): ProviderConfig | number => { ... };
// etc.
```

Adding a new provider requires copying an existing function and editing env var names — a
copy-paste pattern that will eventually introduce a subtle difference (wrong default, missing
fallback) that is hard to catch.

**Impact if deferred:**
No current bug. The risk is in the next provider addition. The current ~5 functions are already
verbose enough that reviewing the block for correctness requires reading each function in full
rather than trusting a shared abstraction.

**Remediation steps:**

1. Define a `ProviderConfigSpec` interface:

   ```typescript
   interface ProviderConfigSpec {
     apiKeyEnvVar: string;
     baseUrlEnvVar: string;
     defaultBaseUrl: string;
     profileApiKeyEnvVar?: string; // for providers that support profile-level key override
   }
   ```

2. Write a single factory:

   ```typescript
   function makeProviderConfig(spec: ProviderConfigSpec): ProviderConfig | number {
     const apiKey = process.env[spec.apiKeyEnvVar];
     if (!apiKey) {
       console.error(`Missing env var: ${spec.apiKeyEnvVar}`);
       return EXIT_INVALID_OPTIONS;
     }
     const baseUrl = process.env[spec.baseUrlEnvVar] ?? spec.defaultBaseUrl;
     return { apiKey, baseUrl };
   }
   ```

3. Replace each getter function body with a `makeProviderConfig(PROVIDER_SPECS.openai)` call, or
   inline the spec at the call site.
4. Keep a thin named wrapper per provider (`getOpenAiConfig`, etc.) so call sites are unchanged.

**Acceptance criteria:**

- [ ] No provider config env-var lookup logic is duplicated across functions.
- [ ] All existing CLI tests pass (including the config phase gate tests).
- [ ] Adding a hypothetical sixth provider requires only a new `ProviderConfigSpec` literal, not
  a new function body.

**Risks and caveats:**
Review each getter carefully before abstracting — some providers may carry extra fields (profile
API key, organisation ID, custom headers) that are not immediately visible from a casual read.
The factory must handle all variations or the abstraction will be leaky. If more than one or two
providers have unique shapes, it may be cleaner to keep explicit functions and accept the
duplication as intentional.

---

### TD-005 — Consolidate narrow-stage input signature builders

| Field      | Value |
|------------|-------|
| Status     | Resolved |
| Priority   | Medium |
| Category   | Maintainability / Correctness |
| Location   | `packages/praecis/youtube/src/eval/narrow-manual-baseline.ts`, `buildStageInputSignature` / `buildExtractionStageInputSignature` |
| Effort     | M (1 day) |
| Discovered | 2026-05-03, adversarial review follow-up |

**Problem:**
`buildStageInputSignature` and `buildExtractionStageInputSignature` are near-duplicate cache
signature builders. The duplication is now risky because these functions protect resume-stage
artifact reuse: when one path gains a new input dimension and the other does not, stale
shortlist/refine/score/judge artifacts can be replayed under the wrong corpus, model, embedding,
or run-mode conditions.

**Impact if deferred:**
No immediate failing behavior after the latest remediation. The risk is future drift: adding a
new invalidation dimension, such as a corpus field, embedding option, prompt-pack ID, or
chunking parameter, requires remembering to update multiple long functions consistently. Missing
one field can silently reuse stale stage artifacts.

**Remediation steps:**

1. Define a shared internal input shape, for example:

   ```typescript
   interface NarrowStageSignatureBaseInput {
     corpus: CorpusEntry[];
     modelIds: string[];
     extractorVariantIds: string[];
     promptConfigIds: string[];
     chunkModes: ChunkMode[];
     runMode: NarrowRunMode;
     maxVideos: number;
     includeManualBaselines: boolean;
     embeddingModel: string;
     embeddingBatchSize: number;
     embeddingTaskType?: string;
     embeddingOutputDimensionality?: number;
   }
   ```

2. Extract a pure `buildNarrowStageSignaturePayload(input)` helper that normalizes order,
   applies default values, and returns a deterministic JSON-serializable object.
3. Make `buildStageInputSignature` and `buildExtractionStageInputSignature` thin wrappers that
   call the shared payload helper and append only the dimensions that are truly stage-specific.
4. Add unit tests that prove both wrappers change when shared dimensions change, and only the
   extraction wrapper changes for extraction-only fields.
5. Keep the exported wrapper names until call sites and tests are migrated; do not combine this
   with the larger orchestration split in TD-006.

**Acceptance criteria:**

- [ ] The two exported signature builders share a single normalization helper.
- [ ] Existing cache-invalidation tests in
  `packages/praecis/youtube/tests/eval/narrow-manual-baseline.test.ts` still pass.
- [ ] New tests cover at least corpus signature, model IDs, prompt configs, chunk modes, run mode,
  embedding model, embedding batch size, task type, and output dimensionality.
- [ ] The helper output is deterministic when input arrays are reordered.
- [ ] `pnpm --dir packages/praecis/youtube exec vitest run packages/praecis/youtube/tests/eval/narrow-manual-baseline.test.ts --reporter=dot`
  passes.

**Risks and caveats:**
Treat this as a cache-contract refactor, not cosmetic DRY cleanup. Before patching, snapshot a
representative old signature payload from tests, then deliberately update fixtures only where
the normalized contract changes for a documented reason.

**Resolution:**
Resolved in the remediation branch by extracting shared `buildNarrowStageSignaturePayload(...)`
normalization and retaining stage-specific wrapper functions for the two cache signatures. The
remaining narrow-baseline structural work is tracked separately in TD-006.

---

### TD-006 — Decompose narrow baseline coverage, rendering, teacher analysis, and orchestration

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | High |
| Category   | Maintainability / Testability |
| Location   | `packages/praecis/youtube/src/eval/narrow-manual-baseline.ts`, `runNarrowManualBaselineComparison` |
| Effort     | L (3–5 days) |
| Discovered | 2026-05-03, adversarial review follow-up; reconfirmed 2026-05-07 final review |

**Problem:**
`runNarrowManualBaselineComparison` is a long orchestration function with many mutable locals,
stage-specific cache/resume branches, nested loops, and report assembly logic. It is doing too
many jobs at once: input preparation, resume artifact validation, harness execution,
coverage scoring, refinement, judging, scoring, file output, and final report assembly.

The signature-builder duplication called out in the same review pass has been resolved under
TD-005. The remaining risk is the file-level and function-level god-object shape: coverage
calculation, report rendering, teacher-aware analysis, artifact persistence, and orchestration are
still concentrated in one large module.

**Impact if deferred:**
The function is currently test-covered, but maintenance risk is high. Small fixes tend to require
reading hundreds of lines and can easily disturb unrelated stages. It also makes targeted tests
harder: many behaviors can only be exercised through a broad end-to-end-style harness call.

**Remediation steps:**

1. Introduce a `NarrowBaselineRunContext` value object that holds immutable run inputs:
   corpus, models, selected variants, mode preset, manual baselines, cache paths, output paths,
   embedding config, budget state, and clock/random helpers where applicable.
2. Extract pure domain modules before moving orchestration:
   - `coverage-engine.ts` for gold/manual/fallback coverage scoring and coverage summaries.
   - `narrow-report-renderer.ts` for Markdown/JSON report shaping and deterministic ordering.
   - `teacher-analysis.ts` for teacher-aware hints, manual-baseline comparison, and gap analysis.
   - `stage-artifact-store.ts` for validated artifact read/write and resume invalidation.
3. Extract one typed function per stage:
   `runShortlistStage`, `runExtractionStage`, `runCoverageStage`, `runRefineStage`,
   `runJudgeStage`, `runScoreStage`, and `buildNarrowBaselineReport`.
4. Give each stage an explicit input and output type. Avoid stages mutating shared arrays; return
   new stage artifacts and derived report fragments.
5. Keep artifact read/write and schema validation behind a small `StageArtifactStore` helper so
   resume behavior is tested once and used consistently by all stages.
6. Refactor incrementally under characterization tests. After each extraction, run the focused
   narrow baseline tests before extracting the next stage.
7. When complete, reduce `runNarrowManualBaselineComparison` to context creation, stage sequencing,
   and final report persistence.

**Acceptance criteria:**

- [ ] `runNarrowManualBaselineComparison` is reduced to orchestration only and is under roughly
  150–200 lines.
- [ ] Coverage scoring, report rendering, teacher analysis, artifact persistence, and stage
  orchestration live in separate modules with explicit exported types.
- [ ] Each extracted stage has a focused unit test for normal execution and resume-artifact reuse
  or invalidation.
- [ ] Existing full comparison tests still pass without loosening assertions.
- [ ] Generated JSON and Markdown reports are byte-identical for at least one deterministic
  fixture-backed run, except where the refactor intentionally changes ordering and the change is
  documented.
- [ ] `pnpm --dir packages/praecis/youtube test` passes.

**Risks and caveats:**
This should be its own PR. Do not mix it with algorithm changes, scoring changes, or prompt
changes. The first commit should add characterization tests around current report output and
resume behavior; only then start moving code.

---

### TD-007 — Introduce an injectable logger for YouTube package runtime output

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Medium |
| Category   | Maintainability / Testability |
| Location   | `packages/praecis/youtube/src/**`, `scripts/eval-matrix/**` console output call sites |
| Effort     | M (1–2 days) |
| Discovered | 2026-05-03, adversarial review follow-up; reconfirmed 2026-05-07 final review |

**Problem:**
The YouTube package still writes directly to `console.log`, `console.warn`, and `console.error`
from library modules, CLI handlers, clients, and eval orchestration code. That makes tests noisy,
requires ad-hoc console spies, and prevents callers from suppressing, redirecting, or structuring
runtime diagnostics.

The final review specifically reconfirmed direct `console.*` call sites in
`narrow-manual-baseline.ts`, where production log-level control is currently impossible without
capturing process-level stdout/stderr.

**Impact if deferred:**
Direct console output is manageable for local CLI use, but it becomes a testing and integration
tax as eval automation grows. Library code cannot be embedded cleanly in other tools, and
diagnostic output cannot be correlated with run IDs or emitted as JSON without invasive changes.

**Remediation steps:**

1. Add `packages/praecis/youtube/src/utils/logger.ts` with a small interface:

   ```typescript
   export interface Logger {
     debug(message: string, meta?: Record<string, unknown>): void;
     info(message: string, meta?: Record<string, unknown>): void;
     warn(message: string, meta?: Record<string, unknown>): void;
     error(message: string, meta?: Record<string, unknown>): void;
   }
   ```

2. Provide `consoleLogger`, `silentLogger`, and `createBufferedLogger()` implementations. Keep
   the interface minimal; do not introduce a heavyweight dependency unless structured logging is
   needed immediately.
3. Thread `logger?: Logger` through high-chatter library entry points first:
   `LlmClaimExtractor`, `runNarrowManualBaselineComparison`, transcript clients, and eval CLI
   helpers.
4. Leave top-level CLI commands responsible for choosing `consoleLogger`, `silentLogger`, or a
   JSON logger based on flags.
5. Replace direct console calls in library modules before replacing CLI-only output. CLI status
   lines may remain direct temporarily if they are explicitly user-facing.
6. Add tests using `silentLogger` or `createBufferedLogger()` instead of monkey-patching
   `console`.

**Acceptance criteria:**

- [ ] Library modules under `src/extract`, `src/eval`, and `src/client` do not call `console.*`
  directly except examples in comments.
- [ ] CLI modules are the only place that writes directly to the console, or they inject a logger
  into downstream library functions.
- [ ] Tests that currently spy on `console.*` are migrated to a buffered logger where practical.
- [ ] A quiet-mode CLI test proves expected status output can be suppressed without hiding fatal
  errors.
- [ ] `pnpm --dir packages/praecis/youtube test` passes.

**Risks and caveats:**
Do not obscure user-facing CLI errors. Preserve existing exit-code behavior and ensure fatal
errors still reach stderr. This is a separation-of-concerns change, not a logging product.

---

### TD-008 — Replace test-only exported coverage wrappers with a stable test surface

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | Maintainability |
| Location   | `packages/praecis/youtube/src/eval/narrow-manual-baseline.ts`, `computeGoldCoverage` / `computeStructuralTargetScore` |
| Effort     | S (half day) |
| Discovered | 2026-05-03, adversarial review follow-up |

**Problem:**
`computeGoldCoverage` and `computeStructuralTargetScore` are exported primarily for tests. They
are thin wrappers around lower-level scoring behavior and are not part of a clearly documented
production API. This creates an ambiguous boundary: future users may treat test helpers as stable
public exports, while maintainers may assume they are free to change.

**Impact if deferred:**
Low immediate risk. The main cost is API drift and review ambiguity. Test-only exports can
discourage internal refactors because removing or changing them appears to be a breaking public
API change.

**Remediation steps:**

1. Decide whether the coverage computation should be a real production module. If yes, extract it
   to `packages/praecis/youtube/src/eval/coverage-scorer.ts` with explicit exported types and
   docs.
2. If no, move tests to exercise the lower-level pure helpers through public behavior, or expose a
   clearly named internal test adapter from a `*.test-support.ts` module that is not re-exported
   from the package entrypoint.
3. Update imports in `packages/praecis/youtube/tests/eval/narrow-manual-baseline.test.ts`.
4. Add a short comment at the export boundary explaining whether the API is production-supported
   or test-support only.

**Acceptance criteria:**

- [ ] There are no ambiguous test-only exports from `narrow-manual-baseline.ts`.
- [ ] Coverage scoring tests still cover strict, semantic, and embedding modes.
- [ ] Public package exports, if any, are intentional and documented in code.
- [ ] `pnpm --dir packages/praecis/youtube exec vitest run packages/praecis/youtube/tests/eval/narrow-manual-baseline.test.ts --reporter=dot`
  passes.

**Risks and caveats:**
Do not reduce coverage just to hide an export. If these helpers are genuinely useful outside the
large baseline runner, promote them into a small production module rather than burying them.

---

### TD-009 — Add collision protection to shortened deterministic IDs

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | Correctness / Reliability |
| Location   | `packages/praecis/youtube/src/utils/ids.ts`, shortened SHA-256-derived IDs |
| Effort     | S (half day) |
| Discovered | 2026-05-03, adversarial review follow-up |

**Problem:**
`ids.ts` uses shortened SHA-256 hex digests for deterministic IDs, including a 16-character
prefix in at least one path. A 64-bit identifier is usually adequate for small local datasets,
but there is no collision detection or documented rationale. If the corpus grows substantially,
the failure mode is silent ID aliasing.

**Impact if deferred:**
Low probability today, high confusion if it happens. A collision could merge unrelated resources,
claims, or derived artifacts under the same ID, making downstream graph state and cache artifacts
hard to trust.

**Remediation steps:**

1. Inventory all shortened hash usages in `packages/praecis/youtube/src/utils/ids.ts` and call
   sites that persist the resulting IDs.
2. Decide the target policy:
   - prefer 128-bit prefixes (`slice(0, 32)`) for new deterministic IDs; or
   - keep 64-bit IDs but require collision detection where IDs are generated in batches.
3. For persisted graph/resource IDs, prefer increasing to 128-bit while this project is still
   greenfield and backward compatibility is not required.
4. Add a development/test-only helper that asserts uniqueness across generated fixture IDs and
   throws with the colliding source inputs if a collision appears.
5. Update tests in `packages/praecis/youtube/tests/utils/ids.test.ts` to lock the new ID length
   and deterministic behavior.
6. If output fixtures change, regenerate only affected fixtures and document the reason in the
   PR notes.

**Acceptance criteria:**

- [ ] All shortened deterministic IDs have an explicit length policy in `ids.ts`.
- [ ] Tests assert deterministic output, expected length, and uniqueness across representative
  fixture batches.
- [ ] Any remaining 64-bit ID includes either collision detection or a comment explaining why the
  collision domain is bounded.
- [ ] `pnpm --dir packages/praecis/youtube exec vitest run packages/praecis/youtube/tests/utils/ids.test.ts --reporter=dot`
  passes.

**Risks and caveats:**
Changing ID length may invalidate local caches and generated fixtures. Because the project is
greenfield, prefer correctness over compatibility, but keep the change isolated and call out the
cache/fixture impact in the PR.

---

### TD-010 — Normalize config fixture permissions in test setup

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | Test Hygiene / Security |
| Location   | `packages/praecis/youtube/tests/fixtures/config/aidha.yaml`, config-permission tests |
| Effort     | S (1–2 hours) |
| Discovered | 2026-05-03, adversarial review follow-up |

**Problem:**
The config fixture is stored with ordinary repository file permissions, while runtime config
guidance warns when config files are group/world-readable and recommends `0600`. The fixture is
not a real secret, but tests that touch file-permission validation can produce avoidable warnings
or normalize insecure-looking behavior.

**Impact if deferred:**
Low risk. The current fixture does not contain a real credential. The cost is noisy tests and a
minor mismatch between security guidance and fixture setup.

**Remediation steps:**

1. Identify the tests that load `packages/praecis/youtube/tests/fixtures/config/aidha.yaml`
   directly.
2. Stop relying on repository mode bits for permission-sensitive tests. Instead, copy the fixture
   to a temporary directory in `beforeEach`, then explicitly `chmod` it to `0o600` or `0o644`
   depending on the behavior under test.
3. Add one test for the secure path (`0o600`, no warning) and one for the warning path (`0o644`,
   warning emitted with the recommended `chmod 600 <path>` guidance).
4. Keep the committed fixture free of real secrets and continue using environment-variable
   placeholders for API keys.

**Acceptance criteria:**

- [ ] Permission-sensitive config tests create temp config files with explicit mode bits.
- [ ] Secure fixture mode produces no warning.
- [ ] Insecure fixture mode produces the expected warning and does not mutate the file silently.
- [ ] Tests do not depend on Git preserving executable/read bits in a platform-specific way.
- [ ] `pnpm --dir packages/praecis/youtube exec vitest run packages/praecis/youtube/tests/cli-config*.test.ts --reporter=dot`
  passes.

**Risks and caveats:**
Windows and some mounted filesystems handle POSIX modes differently. If tests run cross-platform,
guard permission assertions behind a platform capability check rather than weakening the Unix
behavior.

---

### TD-011 — Strengthen LLM chunking regression assertions

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | Test Quality |
| Location   | `packages/praecis/youtube/tests/llm-claims.test.ts` |
| Effort     | S (1-2 hours) |
| Discovered | 2026-05-06, adversarial review follow-up; reconfirmed 2026-05-07 final review |

**Problem:**
Two LLM chunking tests currently prove that chunking produced multiple LLM calls, but they do not
assert the stronger behavioral contract:

- semantic-overlap chunking should include overlapping transcript excerpts at chunk boundaries;
- hard max token splitting should produce a bounded chunk count and preserve per-chunk token
  compliance in diagnostics.

**Impact if deferred:**
Low immediate risk because the production code is covered by broader extraction tests. The gap is
test precision: a future chunker regression could still make multiple calls while dropping overlap
context or exceeding the intended hard split budget.

**Remediation steps:**

1. Update the semantic-overlap test to inspect captured client prompts or request metadata and
   assert that at least one excerpt appears in adjacent chunk requests.
2. Update the hard max token split test to assert the expected chunk count for the fixture, or use
   `getLastRunStats()` to assert chunk diagnostics stay within the configured hard max except for
   explicitly unsplittable single-excerpt cases.
3. Keep fixtures deterministic and avoid adding live LLM calls.

**Acceptance criteria:**

- [ ] The semantic-overlap test fails if overlap excerpts are removed.
- [ ] The hard max token split test fails if chunk count or token diagnostics exceed the expected
  fixture boundary.
- [ ] `pnpm --dir packages/praecis/youtube exec vitest run tests/llm-claims.test.ts --silent --reporter=dot`
  passes.

**Risks and caveats:**
Do not overfit assertions to incidental prompt formatting. Prefer excerpt IDs or normalized excerpt
text markers over brittle full-prompt snapshots.

---

### TD-012 — Call out embedding default change in PR and release notes

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | Documentation / Release Hygiene |
| Location   | PR description; `packages/praecis/youtube/src/eval/narrow-manual-baseline.ts` embedding defaults |
| Effort     | S (15–30 minutes) |
| Discovered | 2026-05-07, final adversarial review |

**Problem:**
The embedding model default changed from `gemini-embedding-2-preview` to
`gemini-embedding-001`. That is a silent behavioral change for any caller relying on the default
embedding model rather than specifying one explicitly.

**Impact if deferred:**
The code change may be technically correct, but reviewers and future maintainers will not see the
behavioral change in the PR narrative. Default model changes affect cache identity, eval
comparability, embedding cost, and downstream score reproducibility.

**Remediation steps:**

1. Add an explicit bullet to the PR description under behavior changes:
   `Default embedding model changed from gemini-embedding-2-preview to gemini-embedding-001`.
2. Mention expected impact: existing eval caches or comparisons that depend on the default may not
   be comparable across the change unless the embedding model is pinned.
3. If this branch has a package changelog or release note section before merge, add the same note
   there.
4. Prefer a config migration note over compatibility code because the repository is greenfield and
   backward compatibility is not required.

**Acceptance criteria:**

- [ ] PR description includes the default model change and its cache/eval comparability impact.
- [ ] Any release notes or changelog updated by this branch include the same note.
- [ ] No code change is made solely to preserve the old default unless a maintainer explicitly
  reverses the behavioral decision.

**Risks and caveats:**
This is documentation debt, not a code blocker. Do not create a second default or compatibility
alias without a separate design decision.

---

### TD-013 — Monitor recursive `pnpm lint` timeout against CI behavior

| Field      | Value |
|------------|-------|
| Status     | Open |
| Priority   | Low |
| Category   | CI Reliability / Developer Experience |
| Location   | root `package.json`, `.github/workflows/typescript-packages.yml`, package lint scripts |
| Effort     | S–M (half day to 1 day, depending on root cause) |
| Discovered | 2026-05-07, final adversarial review |

**Problem:**
The recursive root `pnpm lint` command timed out in the local review environment, while package-level
`tsc --noEmit` checks reportedly passed individually for all four TypeScript packages. The current
CI workflow gates on `pnpm lint`, which is expected to have enough compute in GitHub Actions, but
the local timeout is a signal that the command may be too coarse, too slow, or vulnerable to a
hanging package script.

**Impact if deferred:**
If CI also times out, the branch becomes unmergeable despite package-level typechecks passing. If
CI stays green but local lint remains unreliable, developers lose a fast pre-push gate and may stop
running the same command CI uses.

**Remediation steps:**

1. Watch the first GitHub Actions run containing the new TypeScript workflow and confirm whether
   `pnpm lint` completes within the job timeout.
2. If CI times out, split lint into explicit package steps so the slow or hanging package is visible:
   `pnpm --dir packages/aidha-config lint`, `pnpm --dir packages/phyla lint`,
   `pnpm --dir packages/reconditum lint`, and `pnpm --dir packages/praecis/youtube lint`.
3. If only local runs time out, add a documented local fallback command sequence that mirrors CI
   package coverage and records the expected runtime.
4. Consider adding per-package lint job timeouts or a root script that prints package names before
   invoking each lint command, so future hangs identify the responsible package.

**Acceptance criteria:**

- [ ] GitHub Actions evidence shows `pnpm lint` either passes reliably or has been split into
  package-specific lint steps.
- [ ] The repo has one documented local lint fallback if root recursive lint remains too slow in
  constrained environments.
- [ ] Any timeout remediation preserves the CI contract order: lint, unit, integration.
- [ ] `pnpm docs:build` remains a separate CI gate and is not treated as a substitute for lint.

**Risks and caveats:**
Do not weaken CI by removing lint. The acceptable fix is better observability, package-level
isolation, or timeout tuning after evidence from CI.

---

## Resolved Items

- TD-005 — Consolidate narrow-stage input signature builders. Resolved by extracting shared
  `buildNarrowStageSignaturePayload(...)` normalization while preserving stage-specific wrapper
  signatures.

---

## Appendix: Priority and Effort Definitions

| Priority | Definition |
|----------|------------|
| **High** | Concrete, recurring impact on developer velocity or runtime performance; should be addressed in the next available sprint. |
| **Medium** | Real maintenance risk or moderate performance impact; address before the codebase grows significantly in the affected area. |
| **Low** | Hygiene improvement; no active risk; address opportunistically or when touching the affected file for another reason. |

| Effort | Definition |
|--------|------------|
| **S** | Half a day or less; self-contained change, low risk. |
| **M** | 1–2 days; touches multiple call sites or requires a test pass to validate. |
| **L** | 3+ days; architectural change or high integration surface. |
