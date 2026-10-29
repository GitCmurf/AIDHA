---
document_id: AIDHA-TESTING-069
owner: Engineering
status: Draft
version: '0.6'
last_updated: 2026-10-19
title: Durable Source Extraction Checkpoint
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-057]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-069
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-10-19
> **Type:** TESTING

# Durable Source Extraction Checkpoint

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify versioned extraction recovery, transactional admission and failed retry preservation. | — | Draft | AIDHA-PLAN-015 |
| 0.2 | 2026-10-17 | Codex | Verify the public CLI failure contract and typed fixtures. | — | Draft | PR 45 |
| 0.3 | 2026-10-17 | Codex | Verify cache identity and routed-unit consistency. | — | Draft | PR 45 follow-up |
| 0.4 | 2026-10-19 | Codex | Record current-main integration, reserved-group regression and standing technical merge authority | — | Draft | AIDHA-TESTING-094 |
| 0.5 | 2026-10-19 | Codex | Admit fresh delegated snapshots when optional cache identity is absent or blank | — | Draft | PR 45 |
| 0.6 | 2026-10-19 | Codex | Persist and validate the explicit PR42 limitation target map through snapshot and cache reconstruction | — | Draft | PR 42 |

## Purpose and limits

An explicitly selected source distillation must retain a complete, inspectable last committed
extraction after process restart. A failed extraction must not overwrite it. This storage contract
is exercised with public fictional sources and injected fake models through
`createIngestionRuntime`, with real SQLite close/reopen checks. Default miner selection, semantic
acceptance, reader policy and model activation remain separate decisions.

## Scope and schema

An explicitly selected `SourceDistillationMiner` emits a JSON-safe v1 **candidate** after parsed
proposal, quote verification, advisory grounding and projection. The candidate retains the complete
parsed source proposal (including incidental units), final admitted units, rejected units with host
reasons, supporting units, diagnostics/coverage and a required source-level `trusted:false` flag.
The candidate also requires `limitationApplicability`: affirmative retained grounding IDs and an
explicit JSON target-to-limitation map. Admission rebuilds that complete map with the fresh relation
host gates; deterministic projection and candidate hashing preserve it through JSON cache replay
and SQLite reopen. Applicability remains opt-in, untrusted and disabled by default. PR44's segment
repair audit remains a separate extension; this contract does not establish combined compatibility.
Include source canonical ID, extraction intent,
configured model, prompt version and miner identity. The envelope `schemaVersion:1` and parsed
proposal `schemaVersion:1` identify the supported storage and proposal contracts; miner identity
binds the distillation and grounding prompt versions. The exporter finishes the stored snapshot with
resolved Resource ID and exact claim/excerpt IDs. Call this last **successful extraction**, not a
semantic certification or full run history.

The required applicability field and changed miner identity invalidate earlier cache/checkpoint
records. Re-extract affected resources; no compatibility migration is provided for this greenfield
repository.

Define a core-owned Zod (or equivalent typed) v1 validator and a `readExtractionSnapshot(store,
resourceId)` reader. The reader returns `null` for no snapshot, validates Resource type and envelope
for present data, and returns an explicit error for unknown version/corruption; it never silently
treats corrupt data as absent. Graph Resource metadata may remain passthrough, because graph backend
must not import core types. Reserve `extractionSnapshot` against source-provided Resource metadata
mutation. Normalize the candidate to its JSON-wire form at capture, *before*
caching/reporting/storage, then validate it. This intentionally removes `undefined` object
properties while preserving all defined semantic fields. Tests compare canonical JSON values after
SQLite reopen, not raw own-property presence; no `NaN`, functions or cycles may be accepted. Do not
store a raw provider response or imply the model text is trusted.

## Failed-close outcome and retry

Today `RunReport` requires `resourceId`, `dedupAction`, counts and IDs. For
`MiningResult.distillation.failedClosed === true`, `runVector` should return
`{ok:false,error:SourceDistillationClosedError}` **before exporter/reference/classifier**, with
typed `diagnostics`, `sourceCanonicalId` and reported token usage. This avoids fabricated Resource
IDs or success stats. The miner may keep its current internal `{ok:true,
value:{failedClosed:true,...}}` contract; the pipeline converts the outcome. The typed error's
message is concise for CLI reporting; diagnostics stay inspectable for tests/callers. No failed
result is cached. A repeat call with a fresh runtime/cache miss retries generation. Direct exporter
invocation with `failedClosed` must also reject before writing. No Resource is created by the failed
attempt; an existing last-success Resource and all graph material remain byte-for-byte unchanged.

A transport/parse failure that already returns `{ok:false}` upstream remains a failure result. Do
not force it into a success-shaped report. If a parsed proposal exists on a failed close, retaining
it in the typed error is useful but is not required to establish the last-success storage invariant.
The full PLAN-010 failed-run report promise needs an explicit later report API if callers require
one for all error classes.

## Transactional admission

For a valid successful distillation candidate, `GraphPipelineExporter` requires
`store.runInTransaction` before any dedup call. In one transaction: resolve/upsert Resource, upsert
excerpts, claims and evidence edges, then upsert that Resource with the v1 snapshot. Every
`{ok:false}` and thrown exception must abort and return failure. Preserve other Resource
metadata/provenance. Unsupported backends fail before writes; non-distillation exporter behavior
remains unchanged. Do not overwrite a pre-existing snapshot on failed close or failed export. A
second successful extraction may replace the one active snapshot; its active claim IDs are the
checkpoint boundary. Old claim nodes may remain until separate lifecycle/reader work.

A successful graph export may precede a later reference-extraction/classification failure. This
slice proves extraction-export atomicity, not rollback of arbitrary downstream side effects or all
concurrent ingestion. The PLAN-010 stronger all-failed-run rollback statement remains open unless
that broader stage is included and tested. Snapshot insertion must not silently mark unrelated
downstream stages as successful.

## Red-first acceptance tests

The historical [configured-runtime and SQLite
regression](https://github.com/GitCmurf/AIDHA/blob/0016e54c4779947d4b3dc5849fcd5ef04a40185f/packages/praecis/core/tests/pipeline/extraction-snapshot.test.ts)
protects the v0.2 boundaries with fictional inputs. The v0.3 protocol tests and verified results
below supplement that historical test revision.

1. **Full successful round trip:** Public synthetic source with one qualified claim, one example,
   one procedure, one incidental unit and one bad-quote unit. Use the configured runtime factory
   with explicit miner/fake LLM and real SQLite. Close/reopen, call the typed reader, assert exact
   original parsed units, final/rejected/supporting content,
   rationale/conditions/attribution/evidence, diagnostics and active claim/excerpt IDs. Compare
   reopened graph Claim/Excerpt/edge IDs and exact metadata. Version is 1; `trusted:false` remains.
2. **Mid-export rollback:** Inject a store failure after at least Resource+Excerpt+Claim graph
   writes and separately on final snapshot upsert, delegating the transaction to the same SQLite
   instance. Reopen and assert no new/changed Resource, Excerpt, Claim or edge rows. Repeat from an
   existing success and assert its full snapshot and graph state unchanged. A returned error must
   not be swallowed by transaction callback.
3. **Failed close, last success, retry:** First succeed. Force schema/quote fail-close with a fresh
   cache or changed input; assert typed error diagnostics, zero exporter/ref/classifier calls, zero
   cache write, and exact reopened prior snapshot/graph. Then valid retry succeeds and updates the
   snapshot. Also assert failed close on a new source leaves no Resource.
4. **Cache-wire validity:** Hit a valid cached v1 result and assert exact snapshot still exports
   without another model call. Feed a cached pre-v1/missing/corrupt/unknown-version candidate;
   assert it is rejected as a hit and reminted or returns explicit failure, never a summary-only
   snapshot. Check intentionally absent optional keys remain absent after JSON-wire normalization
   and reopen; all defined conditions/evidence remain exact.
5. **Boundaries:** Nontransactional store rejects distillation before any write; legacy miner still
   follows its existing path; source-supplied `resourceMetadata.extractionSnapshot` cannot replace
   exporter-owned state; newer successful extraction preserves unrelated Resource metadata and
   provenance.

The acceptance evidence is a focused red/green log, full affected core/graph suites,
typecheck/build, strict docs/DocOps, exact SQLite close/reopen assertions, and material code review
before commit. No synthetic test can establish semantic recall, entailment or product readiness.

## v0.5 fresh snapshots without cache identity

`ICandidateMiner.extractionSnapshotVersion:1` opts into durable snapshots independently of
`cacheIdentity`. A missing or blank cache identity disables cache reads and writes. Fresh snapshots
still require their own validated miner identity, source, excerpts, routed evidence and candidate
hash. When the wrapper provides a nonblank cache identity, the candidate must match it. Cached
snapshot validation keeps its existing identity requirement.

The regression reproduced the failure on public revision
`9354a2a8afed323c1a9e292dc03f058ffdc16033`: a wrapper delegating to `SourceDistillationMiner`
without forwarding its optional cache identity failed before export. Missing, empty and whitespace
identities each failed at the runtime's snapshot identity check after both fake-model calls.
Fresh admission now uses the candidate's identity only when caching is disabled.

`packages/praecis/core/tests/pipeline/extraction-snapshot.test.ts` exercises the public runtime
factory, actual delegated miner and SQLite close/reopen for all three cases. Each case makes two
fresh attempts with two fake-model responses per attempt and cache methods that throw if used.
The typed reader returns the exact committed checkpoint after each reopen. A separate nonblank
identity mismatch rejects before creating a Resource or writing cache data. The focused regression,
snapshot consistency, distillation and pipeline controls pass 42 tests across four files. The core
build and strict no-emit checking of the affected test file pass. Final documentation and hook
results are recorded with the correction's commit evidence. These local correction checks do not
repeat the full core/CLI suites or call live providers.

## v0.4 current-main integration

The refresh onto main `8c4f40ede2a6736960642add1d398dd9a24dbce2` preserves PR52's transcript
encoding export and miner cache identity, and PR60's source-owned metadata validation and merge
behaviour. The `emptySourceConfigRegistration` re-export is retained.

Combining snapshots with source-owned groups exposed a new integration gap: a group could claim
the core-owned `extractionSnapshot` field. Two new regressions first failed because
`createRawSource` accepted the declaration and direct `applyDedupResolution` created a Resource.
Adding that field to the group validator's reserved set makes both reject with the reserved-field
error; the direct test confirms the Resource query remains empty. See
[AIDHA-TESTING-094](testing-094-source-owned-metadata-groups.md) and
`packages/praecis/core/tests/compose/source-owned-metadata.test.ts`.
This finding does not establish historical data corruption.

The focused refresh run passed 96 tests across nine files, covering those regressions,
existing group controls, snapshot persistence and cache consistency, distillation, pipeline
execution, and transcript prompt fidelity and budget behaviour. The post-fix core build passed.
Strict checking of the five affected core test/fixture files exposed a missing required `label` in
the synthetic pipeline fixture. That omission exists in both merge parents. Adding the label makes
the strict check pass; all seven affected pipeline distillation tests pass after that correction.
Final documentation checks and normal commit-hook results are recorded with the commit evidence.
The older full-suite results below are historical. This refresh has not repeated the full core or
CLI suites or strict CLI test checking locally. All current tests use fictional sources and
injected models; no provider call or private-code upload was made.

## v0.3 historical cache-protocol correction

The base PR45 correction is committed at `5a206966011f61cb00f0015679c1801f368ba34c`. The
[direct consistency tests](https://github.com/GitCmurf/AIDHA/blob/5a206966011f61cb00f0015679c1801f368ba34c/packages/praecis/core/tests/extract/distill/snapshot-consistency.test.ts)
and [configured-runtime
tests](https://github.com/GitCmurf/AIDHA/blob/5a206966011f61cb00f0015679c1801f368ba34c/packages/praecis/core/tests/pipeline/extraction-snapshot.test.ts)
are pinned to that source revision.

The recognized official miner identity now binds typed intent and prompt fields to the candidate
and validates the finite configured threshold against routed quote failures. For base PR45, the
empty-proposal ratio is zero and equality at the threshold passes. Custom identities remain opaque.
Routed ordinary units are reverified against current excerpts: quote-failed units remain unchanged
with the failed-quote reason, quote-valid rejected units remain unchanged with the `ungrounded`
reason, and admitted units retain their original ID, kind, supporting-unit IDs, and full verified
evidence. Valid grounding rewrites to text, rationale, conditions, attribution, stance, and
importance remain accepted on fresh generation and cache replay.

At the source revision above, seven red regressions reproduced identity and routing contradictions.
The focused direct/pipeline suite passed 27/27 tests; the full core suite passed 303/303. Core lint
and build passed. Strict no-emit TypeScript checking of both linked test files exited 0. The tests
reproject and rehash
adverse candidates before asserting the host rejects them; they also verify a legitimate rewrite
and a custom opaque identity. The configured-runtime test confirms cache replay uses zero model
calls after the fresh rewrite. No live model calls or source inputs were used.

An independent four-file review found no material defect in the v1 source correction. The later
v2 test-only normalization was separately reviewed and typechecked; it did not change runtime
bytes and was not part of the native review. The completed native v1 review exits 0 with one Minor
suggestion to use the verifier's `failureRatio` directly. The review assessment confirms that the
current base verifier defines this as failed unit IDs divided by proposal units, with empty input
equal to zero; routing requires every failed unit exactly once, so it matches the final-rejection
ratio currently checked. No present behavioral discrepancy was reproduced. The Minor remains
recorded as assessed, not as a zero-finding review.

This v0.3 correction covers base PR45 only. Segmented-repair ratio semantics and the custom JSON
`segmentedEvidence` identity collision are 037-specific cases and are not claimed as tested here.
The source changes do not alter defaults, model routing, trust flags, or semantic policy. An
unsigned hash and consistency checks are not authentication; without a verdict ledger the host
cannot prove that a permitted rewrite or `ungrounded` rejection came from the model. These tests
do not establish entailment or model quality.

## Verification commands

Run from the repository root with the locked dependencies installed. The offline command requires
those packages in the local cache; a fresh machine needs its normal authorised install.

```sh
pnpm install --frozen-lockfile --offline
pnpm --filter '@aidha/praecis-cli...' build
pnpm --filter @aidha/praecis-core test -- tests/pipeline/extraction-snapshot.test.ts tests/pipeline/distillation.test.ts tests/extract/distill/snapshot-consistency.test.ts
pnpm --filter @aidha/praecis-core test
pnpm --filter @aidha/praecis-core lint
pnpm --filter @aidha/praecis-core build
pnpm --filter @aidha/graph-backend test
pnpm --filter @aidha/praecis-cli test
pnpm --filter @aidha/praecis-cli lint
node scripts/meminit-check.mjs docs/55-testing/testing-069-extraction-checkpoint.md
pnpm docs:build
```

Record actual results and limitations before merge. A skipped or incomplete review is not evidence
of coverage. Noncontroversial technical changes may merge under standing owner authority after
satisfactory review and required checks.

## v0.2 historical verification record

The following results are the preserved v0.2 record published at source revision
`bd9aca6503bf063fbda8b31837dfa726ee9f8c57`. They remain historical and are superseded for the
base cache-protocol correction by the v0.3 results above.

The reviewed runtime and tests are committed as `0016e54c4779947d4b3dc5849fcd5ef04a40185f`. The
initial configured-runtime regression fails on main because the reopened Resource lacks an
extraction checkpoint. With the implementation, all fifteen snapshot-specific checks and all 291
core tests pass. All 156 graph-backend tests, core lint and build also pass. The compiled package
exposes a callable public snapshot reader and the typed failure API.

Independent hash-pinned source reviews cover the full implementation and final correction. The
complete initial native review covers thirteen files and reports two Minor issues: locale-dependent
hash ordering and the temporary branch-based test link. The locale regression fails using real
English/Estonian collation before the correction; deterministic code-unit ordering passes afterward.
The regression restores its collation spy. The test link above is pinned to the reviewed source
commit. Normal source commit hooks pass.

The complete native verification then reports one conditional Major concern about absent optional
fields. The ordinary miner passes fresh and cached runs with those fields absent, so its alleged
failure is not reproduced. A declared-v1 wrapper adding own `undefined` optional fields does
reproduce a narrower comparison failure. Guarded JSON-wire comparison fixes it while retaining
rejection of function and nonfinite values. Peer review catches a throwing-getter escape in that
guard; a failing regression precedes the correction. The final two-file followup is independently
hash-pinned reviewed and passes the tests above. The two full native passes cover their recorded
pre-followup bytes; the final peer review and exact rerun cover the corrective delta. Documentation
and final hosted reports are assessed before merge readiness is claimed.

These fake-model tests establish durability and internal consistency, not semantic recall or
entailment. No real source, new model call, paid collection or default activation is used.

The initial hosted required verification exposes a public CLI test still expecting a successful
summary for failed-close. Its actual assertion failure is the RED evidence; the first local attempt
stops earlier on missing built dependencies. The CLI already propagates upstream typed errors.
After building its complete dependency closure, the corrected public test asserts the typed error,
canonical source ID, diagnostics, available summary, reported usage and zero graph nodes. All 31
CLI tests pass. The snapshot-specific suite passes all fifteen checks, and all 291 core tests pass
again after the shared fictional fixture is corrected. Production runtime bytes remain unchanged.

Additional no-emit TypeScript checks include these exact test files, unlike the package lint
commands that cover source only. Both checks pass after supplying the fixture's required label and
provenance and narrowing nullable values before callbacks and writes. Independent review covers
all three test-file corrections, including removal of a test-only `any`; all eight corrupt-cache
controls remain. These checks add no new test infrastructure or runtime behavior.

The complete initial hosted JavaScript report for `f7b34f1` contains 41 findings: forty Minor and
one Critical. All pages are assessed. The Critical is the test-only type escape removed above;
the remaining findings concern async style, complexity and module-scope warnings on ES modules.
No demonstrated runtime defect is identified by those findings. CodeQL and the other analyzers
pass. Hosted CodeRabbit and Qodo explicitly skip and provide no coverage. Final required checks
and actual reports must be refreshed on the corrected PR head before merge readiness is claimed.
