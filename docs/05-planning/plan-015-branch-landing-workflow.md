---
document_id: AIDHA-PLAN-015
owner: Engineering
status: Draft
version: '0.20'
last_updated: 2026-10-29
title: Branch Landing and Next Sprints Workflow
type: PLAN
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-009, AIDHA-PLAN-008, AIDHA-PLAN-010, AIDHA-PLAN-011, AIDHA-PLAN-012, AIDHA-PLAN-013, AIDHA-PLAN-014]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PLAN-015
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.20
> **Last Updated:** 2026-10-29
> **Type:** PLAN

# Branch Landing and Next Sprints Workflow

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-16 | Codex | Record the authorised extraction, review and PR workflow, subsequent outcome-focused sprints, owner gates and restart notes. | — | Draft | Owner request |
| 0.2 | 2026-10-16 | Codex | Distinguish skipped bot reviews from actual reports; retain genuine findings, CI and completed peer/CLI review gates. | CMF | Draft | Owner clarification |
| 0.3 | 2026-10-16 | Codex | Publish the first independent PR batch, record assessed review findings, and add inventory sidecar metadata. | — | Draft | PRs 27–30 |
| 0.4 | 2026-10-16 | Codex | Record owner approval and land the first batch with unchanged reviewed patches and refreshed CI. | CMF | Draft | PRs 27–30 |
| 0.5 | 2026-10-16 | Codex | Publish the next owner review brief, second-batch evidence and dependency maintenance priority. | — | Draft | PRs 31–32 |
| 0.6 | 2026-10-16 | Codex | Record and resolve the late test Git-environment isolation finding. | — | Draft | PR 32 |
| 0.7 | 2026-10-16 | Codex | Record second-batch owner approval and merge evidence. | CMF | Draft | PRs 31–32 |
| 0.8 | 2026-10-16 | Codex | Prepare scoped email parser maintenance and prioritize deterministic distillation contracts. | — | Draft | PLAN-015 |
| 0.9 | 2026-10-16 | Codex | Record final PR 33 CI, actual bot assessment and concrete owner merge review. | — | Draft | PR 33 |
| 0.10 | 2026-10-17 | Codex | Record owner approval, merge PR 33 and refresh remaining dependency alerts. | CMF | Draft | PR 33 |
| 0.11 | 2026-10-17 | Codex | Extract validation and evidence checks for model-generated distillations with explicit semantic limits. | — | Draft | AIDHA-TESTING-056 |
| 0.12 | 2026-10-17 | Codex | Record final PR 34 verification, reproduced bot fixes, remaining complexity advisories and the owner merge gate. | — | Draft | PR 34 |
| 0.13 | 2026-10-17 | Codex | Record owner approval and PR 34 merge; prepare the bounded generation and grounding slice. | CMF | Draft | PR 34 |
| 0.14 | 2026-10-17 | Codex | Record PR 35 final checks, actual bot assessment and concrete owner merge brief. | — | Draft | PR 35 |
| 0.15 | 2026-10-17 | Codex | Record PR 35 approval, merge-gate sequencing error, corrective slice and semantic-quality priority. | CMF | Draft | PR 35 |
| 0.16 | 2026-10-17 | Codex | Record the reviewed context correction, semantic checkpoint and explicit hold on unstable experiments. | — | Draft | AIDHA-TESTING-059 |
| 0.17 | 2026-10-17 | Codex | Refresh the decision-model shortlist and task-specific evaluation plan; preserve failed native replies after a genuine bot finding. | — | Draft | PR 37; owner model refresh |
| 0.18 | 2026-10-18 | Codex | Record the standing technical merge authority, PR 37 and PR 56 landings, and retain the separate product and private-data gates. | — | Draft | Owner instruction; PRs 37 and 56 |
| 0.19 | 2026-10-18 | Codex | Clarify that older batch approval gates are dated history and align the active checklist with the standing technical authority. | — | Draft | PR 57 Greptile finding |
| 0.20 | 2026-10-29 | Codex | Integrate the separate offline decision checkpoint while retaining current authority. | — | Draft | PR 38; AIDHA-TESTING-060 |

## Purpose and authority

Separate accumulated work into coherent, independently verified PRs and land it in dependency
order. Then establish whether the reader and continuity workflows reduce the owner's effort.
This file is the execution checklist and handoff record; it does not replace PEPYS commitment
authority. Check items only when evidence exists. Keep unfinished work and limitations visible.

The owner authorises local preparation, fixes, delegation, code review, pushing relevant branches
and opening PRs. Existing CodeRabbit permission applies to this repository. Exclude credentials
and private runtime material from external review and publication.

The owner has granted standing authority to merge reviewed, noncontroversial, pure technical PRs
after PR 37 without requesting a separate approval for each eligible PR. This authority covers
implementation and maintenance changes whose behaviour remains within an already authorised
technical scope, after the latest head passes required checks and actual reporting-bot findings
are assessed. Skipped bots supply no coverage. It does not approve new product behaviour or defaults,
model selection or new model-call scopes, additional spend or services, private-source processing
or disclosure, or new account, credential or access scopes. This standing rule does not extend
existing authority for those decisions; existing named or task-specific authorisations remain
valid, and only decisions beyond those scopes require specific owner authority.

PR 37, the reviewed synthetic semantic-quality checkpoint, merged as `27ee9fa`; its expectations
remain assistant-authored provisional examples, not human gold and not evidence of semantic
improvement. PR 56, the explicit-config fail-closed correction, later merged as `29424fc` on top
of PR 37. These records establish the technical merge sequence; they do not extend authority to
the excluded product, model, spend or private-data decisions.

The owner clarified that some repository review bots use older free-tier configurations and
now skip under changed eligibility criteria. Ignore skipped reviews (including CodeRabbit and
Qodo skips); do not wait for them, count a skipped-success status as approval, trigger paid work
or reactivate subscriptions. **Consider bots that actually produce reports or findings.** Inspect
those reports and resolve confirmed issues before merging. Actual build/test/docs/secret-scan CI
and completed local, peer or explicitly requested CLI reviews remain separate evidence. A completed
CodeRabbit CLI review is distinct from a skipped CodeRabbit GitHub bot review.

The batch summaries and dated work notes below preserve decisions and status as recorded at the
time. Current and future work follows the authority above and the owner decision/merge checklist
below; later entries supersede earlier status snapshots.

## Owner merge brief for the first batch

The owner explicitly approved PR 28 (workflow), PR 27 (graph), PR 30 (dotenv) and PR 29 (VTT)
on 2026-10-16. This approval covers those four named PRs and routine base synchronization; it does
not approve merging future slices. They are independent of the unfinished reader/core changes.
All four PRs are merged. The source branch remains preserved. The full landing sprint is still open.

| PR | Reviewed code / documentation revision | Evidence and review limit | Merge risk |
| --- | --- | --- | --- |
| [28 — workflow](https://github.com/GitCmurf/AIDHA/pull/28) | `dea401a` → merged `1cd67f0` | Final-head required CI, sidecar schema and peer review pass | Docs and navigation only |
| [27 — graph](https://github.com/GitCmurf/AIDHA/pull/27) | `1db19c4`; synchronized `62c2048` → merged `e2459c5` | 156 graph tests, focused follow-up, completed CodeRabbit review/verification; required CI passes | Startup count fix; missing-row check, not full index audit |
| [30 — dotenv](https://github.com/GitCmurf/AIDHA/pull/30) | `7535527`; synchronized `d64a7c9` → merged `3a38fff` | 29 CLI / 37 loader tests, review/verification and required CI pass. Four static fixture false positives are documented | Three-line resolver forwarding change; no credentials or account changes |
| [29 — VTT](https://github.com/GitCmurf/AIDHA/pull/29) | `6017610`; synchronized `3de871b` → merged `475f615` | 47 final focused tests, prior 1061-test package run, completed reviews and final required full CI pass | Safe cue cleanup; full HTML decoding and ambiguous deduplication stay separate |

Read-only branch-protection inspection confirms required checks are `build`, `verify` and
`gitleaks`, with strict up-to-date enforcement. After each approved merge, refresh every remaining
PR against the new main, regenerate affected docs indices, verify unchanged intended scope and
rerun required CI before the next merge. Do not bypass checks or change repository settings.
DeepSource's four assessed fixture warnings on PR 30 are advisory rather than required checks;
the red JavaScript status must remain disclosed unless its reporting service is corrected.

## Second batch approval and landing

The owner explicitly approved PRs 32 and 31 on 2026-10-16: “both approved”. This covers
those two named PRs and routine base synchronization. At that time, future PRs needed separate
merge approval. The standing authority recorded in v0.18 now applies to later eligible technical
PRs; reserved decisions retain their specific owner gates.
Both PRs are merged. No further owner action is needed for this batch. The full source branch
remains open.

| PR | Approved behavior | Current stage and review limits |
| --- | --- | --- |
| [PR 32: private-artifact guard](https://github.com/GitCmurf/AIDHA/pull/32) | Real pilot records stay outside public Git. Synthetic examples remain permitted. The guard checks path patterns; content still needs review | Merged as `01ec0ed` after exact-head required CI and actual reporting-bot findings were assessed. Final isolation fix has peer review and regression coverage; extra CLI attempt had no coverage because of quota |
| [PR 31: taxonomy provenance](https://github.com/GitCmurf/AIDHA/pull/31) | Stored automatic assignments identify their matching vocabulary; the fingerprint does not certify classification quality or version the full algorithm | Merged as `33f40cd` from synchronized head `4ad7e88` after fresh required CI and actual reports passed. Its stable patch and all eleven non-generated blobs match approved `4021473` |

Engineering merged these two approved PRs after their synchronized heads passed required checks.
No force push, admin override, paid-review activation or repository-settings change was used for
this batch.

## PR 33 approved and merged

The owner explicitly approved [PR 33](https://github.com/GitCmurf/AIDHA/pull/33) on 2026-10-17.
It merged as `580b94c` from the unchanged approved head `a5d9651`. All required checks passed
and the three actual review threads were resolved before merging. The integrated main tree is
identical to the approved, tested PR tree. No further owner approval is needed for this merge.

The email parser update has 182 passing affected-package tests and 54 passing documentation
URLs. DeepSource's advisory JavaScript status remains red for the documented module-syntax
false positive; its two style findings are fixed. Skipped bots supply no review coverage.

The refreshed GitHub inventory has 22 open alerts (15 high, seven medium); none names the
updated email parser chain. The thirteen previously open email-chain alerts are no longer open.
This is a dated dependency snapshot, not proof that every remaining alert is reachable.
Configuration/build-tool and documentation-tool maintenance remain separate slices. No owner
product, spending or account decision blocks the next synthetic engineering slice. At the time of
this 2026-10-17 status note, future PRs still had individual merge gates. The standing authority
recorded in v0.18 supersedes that rule for eligible pure technical PRs; reserved decisions retain
their specific owner gates.

## PR 34 approved and merged

The owner approved [PR 34](https://github.com/GitCmurf/AIDHA/pull/34) on 2026-10-17. It merged
as `1c83ecb` from unchanged `dd55b43`, based on `580b94c`,
with exactly sixteen intended files. It adds validation and evidence checks for model-generated
distillations. No provider, default pipeline, storage or dependency change is included.
Mechanical acceptance does not establish semantic entailment or extraction quality.

- [x] Reproduce and fix confirmed independent/CLI/reporting-bot defects with regressions.
- [x] Pass all 221 core tests, including 82 new contract tests; owning build/lint and docs pass.
- [x] Pass final-head required build, documentation verification and secret scanning.
- [x] Inspect and resolve actual reporting-bot threads; retain the documented complexity risk.
- [x] Preserve all 69 original baseline paths and the original unstaged index.
- [x] Obtain separate owner approval for PR 34.
- [x] Refresh the reviewed head/base and required checks, then merge the approved scope.
- [x] Verify integrated main and refresh context/ledger after merging.

The approved and integrated trees are identical. The remaining documented risk is maintenance
complexity: DeepSource's advisory JavaScript status is red, including quotation-matcher complexity
17 (high). Explicit boundary guards have regression and independent review coverage; thresholds
and suppression settings are unchanged. No paid-review or account change was needed.

The previous CodeRabbit CLI verification covered the initial sixteen-file candidate. Later bot
fixes have independent peer review and regressions; do not claim that CLI run covers the final
code. CodeRabbit GitHub, Qodo and Macroscope skips supply no review coverage. Greptile's two actual
correctness findings are reproduced and fixed. Actual CodeQL and DeepSource Python/Secrets/Shell
results pass. The PR description holds current CI links and the complete review assessment.

Next engineering order: extract and test a bounded model-generation/semantic-grounding pipeline
using injected dependencies and production entrypoints, then demonstrate the reader's answer to
the existing real question. Synthetic orchestration tests do not prove model quality. Keep
configuration/YAML and build/docs dependency maintenance in independent PRs before relevant real
pilots. No new owner product decision blocks synthetic preparation; private inputs and merge
approvals retain their existing gates.

## PR 35 approved and merged; semantic quality is next

The owner approved [PR 35](https://github.com/GitCmurf/AIDHA/pull/35) on 2026-10-17 and
specified semantic-quality improvement as the intended destination of this branch. PR 35 merged
as `5b81d23` from reviewed `b08f8ab`. The integrated tree matches the reviewed tree exactly and
required checks passed. The default extractor remains selected; the new miner is injectable.

A late Greptile report identified repeated source excerpts in the grounding prompt. The review
gate detected the additional unresolved thread, but a shell sequencing error allowed the merge
command to run after that failed check. This was an execution error. Future dependent mutations
must be separate calls after a successful gate, or joined with an explicit success condition.
The owner was informed. Preserve this record rather than describing the merge as fully gated.

The confirmed finding has a separate corrective slice, `024-grounding-context`: one complete
source table, each unit's own cited IDs, and a bumped grounding/cache version. A ten-unit
regression fails before the fix and passes afterward. Independent review finds no actionable
correctness issue. Documentation and reporting-bot checks remain recorded per candidate.
Skipped bots supply no coverage. DeepSource's assessed maintenance warnings and dashboard-only
findings inaccessible with HTTP 403 remain the review limits recorded on PR 35.

- [x] Obtain separate owner approval for PR 35 and merge the approved head.
- [x] Verify exact integrated-tree equality.
- [x] Reproduce the late shared-excerpt finding and prepare a separate correction.
- [x] Complete correction checks/reviews and publish PR 36.
- [x] Obtain separate owner approval and merge PR 36 as `be9876c` after its fresh review gate.
- [x] Verify all four PR 35 post-merge main CI workflows pass.
- [x] Attempt the context helper; missing `specs/024-grounding-context/plan.md` prevents it
  before edits. The governed workflow and testing specs remain the restart record.

### Next sprint: semantic-quality evaluation and improvement

The target is better preservation of useful meaning, beyond mechanically valid output.

- [x] Freeze three newly authored public multi-excerpt sources and provisional semantic expectations.
- [x] Keep expectations out of generation and grounding prompts; preserve the original private texts.
- [x] Exercise the actual miner, runtime and exporter with a bounded native-model baseline.
- [x] Review core-idea recall, qualifiers, corrections, origins, rationale and procedural leakage.
- [x] Test targeted corrections against the same model and frozen sources; record all failures.
- [ ] Demonstrate a repeatable improvement before landing experimental semantic changes.
- [x] Keep source-level omission, grounding and projection losses separately inspectable.
- [ ] Show the owner concrete before/after evidence; do not claim synthetic expectations are human gold.

`025-semantic-quality` prepares this work independently. Native Claude subscription calls use
public synthetic text only, tools disabled, and no new API credentials or service activation.
Record the actual resolved model and usage; native CLI results do not establish API-provider
parity or default-pipeline quality. Source-report persistence follows when needed for the real
reader trial; it is not a substitute for measuring semantic usefulness. No owner input blocks
this preparation. Eligible pure technical PRs use the standing authority above after fresh checks
and report review; reserved decisions retain their specific owner gates.

## Model refresh before further semantic tuning

The owner identified newer decision models on 2026-10-17. Refresh model selection separately
for each ingestion task. The current checkpoint used one native generative model and low effort;
it cannot establish the current quality/cost frontier or rank decision-only models.

| Task | Model role and acceptance focus |
| --- | --- |
| Source distillation and wording repair | A generative writer must preserve useful meaning, source-stated rationale, qualifications and attribution; refresh the strong generative baseline |
| Taxonomy, unit kind and relevance | Bounded decisions over explicit category definitions, including unknown/abstain and overlapping topics |
| Grounding and limitation applicability | Evidence-backed accept/reject/escalate or target selection; measure misleading false acceptance separately from unnecessary rejection |
| Quote, reference and persistence checks | Existing deterministic checks remain mandatory regardless of model confidence |

### Dated candidate inventory

Verified official/provider documentation on 2026-10-17; prices are USD per million input tokens.
These are candidates, not an AIDHA ranking. Quoted zero output pricing does not make requests free.

| Candidate | Published input / output price | Route and evidence |
| --- | --- | --- |
| TypeSafe Jev 1.14 | $0.042 / $0 | [OpenRouter current Jev guide](https://openrouter.ai/blog/insights/what-is-jev/). Pin the resolved version rather than a latest alias |
| Microsoft-Decision-1 | $0.042 / $0 | [Microsoft launch and pricing](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/). Foundry or OpenRouter |
| GPT-6 Luna Decisions | $0.10 / $0 | [Official OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions). The quoted rate is specific to `/v1/decisions`, with regional/long-context premiums |
| Liquid d1-ultra | $0.042 / $0 on the listed route | [Current OpenRouter model listing](https://openrouter.ai/liquid/d1-ultra). Recheck route availability and per-question charging before execution |
| Cloudflare Clef / Clef-flash | Recheck selected route before execution | [Cloudflare launch](https://blog.cloudflare.com/clef-decision-models/). Hosted or open weights, with local operational costs evaluated separately |

Also screen lower-priced alternatives in the
[provider decision-model catalog](https://openrouter.ai/models?output_modalities=decisions),
including current Perplexity Decider variants. Confirm the exact model page and API contract;
a rendered catalog can ignore filters. Include a current strong structured-output generative
comparator and the existing keyword/rule baseline where applicable. Do not adopt a vendor
leaderboard's winner without testing AIDHA's tasks.

### Evaluation and next implementation checklist

- [x] Verify the Microsoft and OpenAI launches, dedicated decision APIs and input-only pricing.
- [x] Record a dated shortlist and retain the existing semantic checkpoint's failed comparisons.
- [ ] Define separate generation, category and evidence-judgment datasets and release criteria.
  Add independently reviewed held-out examples, ambiguous/unknown cases and critical qualifier,
  correction, origin and measured-outcome errors. The current three-source corpus is a smoke
  checkpoint, not enough to estimate rare false-accept rates.
- [ ] Add an injectable decision adapter and offline contract tests without changing defaults.
  Preserve provider refusals, unknown results, raw replies, usage, model version and failures.
  Translate each provider's actual schema; do not force a decision endpoint through chat JSON.
- [ ] Compare identical evidence and rubric across the screened models, with repeated runs,
  held-out sources and label/order/paraphrase perturbations. Keep tuning examples separate.
- [ ] Report task accuracy and per-class precision/recall, false accept/reject counts, abstention,
  calibration, p50/p95 latency and measured full cost including repeated state per question,
  caching, retries and escalation. Record native CLI/API differences instead of assuming parity.
- [ ] Specify bounded request counts, token/input limits, cost ceiling and authorised endpoint
  before live comparison. Use public synthetic inputs first; preparation needs no new account.
- [ ] Select the nondominated options per task only after applying critical-error quality gates.
  A cheaper/faster model with worse fidelity is not an improvement unless the tradeoff is explicit.
- [ ] Re-run the full miner/exporter path with the selected writer and advisory decider; prove
  meaningful improvement before enabling a new default or landing held semantic experiments.

Start this refresh before more tuning of the held prompt experiment. In parallel, prepare
source-backed limitation applicability and persistence/retrieval tests already identified below.
A decider can select, reject or escalate a candidate; the writer must still compose any repaired
claim. Typed JSON and confidence values alone do not establish semantic correctness.

No owner decision blocks research, fixtures or adapter preparation. A new charged endpoint or
private-source destination needs its own concrete bounded request when implementation reaches
that dependency. No activation, new model calls or model-default changes are part of PR 37.

## Restart procedure

1. Read this file and `AGENTS.md`, including the [Slice ledger](#slice-ledger) and
   [Work notes](#work-notes) sections below.
2. Verify checkout, branch, dirty files, worktrees, live remote refs and PR state; do not assume
   recorded hashes, CI results or review outcomes remain current.
3. Identify the first unchecked actionable item. Preserve other work and record the exact
   operation, base and result before moving to the next stage.
4. Keep review receipts and recovery artifacts locally; link public PRs and publishable evidence
   here. Never substitute elapsed time, a heartbeat or an interrupted review for completion.

## Sprint 1: Separate, review and land existing work

### Preserve and map

- [x] Record initial branch and working-tree scope; see baseline work note.
- [x] Save this workflow with checkboxes and work notes.
- [x] Save a recovery snapshot of tracked edits and non-ignored untracked files; record hashes.
- [x] Refresh remote refs and inspect existing PRs without changing the active checkout.
- [x] Inventory all commits and uncommitted paths; assign every path to a slice or explicit hold.
- [ ] Map dependencies, review evidence, known defects and acceptance tests for every slice.
- [x] Select the first independently testable slice and record its verified base.

### Repeat for every slice

- [ ] Create an isolated worktree on an `NNN-short-name` branch from the verified base.
- [ ] Extract code, tests, comments and supporting docs together; inspect the complete diff.
- [ ] Verify the slice works without unrelated changes. Use stacked PRs only for real dependencies.
- [ ] Reproduce confirmed defects with failing tests, implement the fix and run relevant checks.
- [ ] Run appropriate build, lint, unit, integration and public-entrypoint checks.
- [ ] Run relevant browser checks serially, preserving live data and using isolated fixtures.
- [ ] Run scoped DocOps, documentation build and public-artifact/secret checks.
- [ ] Complete code review before committing; resolve actionable findings and verify changes.
- [ ] Verify exact staged file list, create a conventional commit and retain review identity.
- [ ] Push the branch and open a PR with purpose, initiating specification, evidence and risks.
- [ ] Verify the GitHub PR base, head, file list and CI results against the intended slice.
- [ ] Inspect actual repository bot reports, comments and inline threads; ignore bots that skip
  rather than treating skipped statuses as approval or waiting for unavailable reviews.
- [ ] Fix confirmed findings from actual bot reports and local/peer/CLI reviews; document rejected
  findings, rerun affected checks and push fixes. Do not activate paid reviews or subscriptions.
- [ ] Verify actual CI and completed review coverage of the latest head; record limits explicitly.
- [ ] Confirm whether the change fits the standing pure-technical authority above; obtain specific
  owner authority when it crosses any reserved product, model, spend, account or private-data gate.
- [ ] After a merge, refresh dependent bases, revalidate and update the ledger.

The repeated checklist is a template. Each slice needs its own stage/evidence entry in the ledger;
checking the template once does not establish completion for every PR. Prefer independent PRs
against `main`; use dependency-ordered or stacked PRs when separation would otherwise break a
contract. Do not split tightly coupled code merely to reduce file counts or rewrite the source
branch to make an extraction appear complete.

### Sprint completion

- [ ] Every original commit and uncommitted path is accounted for as landed, superseded with
  evidence, or retained with an explicit reason and next action.
- [ ] No private runtime evidence has entered published paths or PRs.
- [x] Approved first-batch merges are complete and integrated main passes required checks;
  later slices follow the current merge authority above.
- [ ] Deferred product requirements remain in the subsequent sprint checklist.

## Slice ledger

Supporting document IDs refer to the preserved source checkout until their owning slices land.
Do not introduce links to pages absent from a PR base.

| Slice | Base / dependencies | Branch / PR | Stage and next action | Evidence / findings |
| --- | --- | --- | --- | --- |
| Graph search startup optimisation | Verified `main` at `eff2087`; independent | `015-graph-search-startup` / [PR 27](https://github.com/GitCmurf/AIDHA/pull/27) | Merged as `e2459c5` after base refresh and final-head required CI | 156 tests, lint/build/docs/DocOps and completed deep CodeRabbit review pass |
| Private public-artifact guard | Independent; integrated `main` at `475f615` | `019-private-artifact-guard` / [PR 32](https://github.com/GitCmurf/AIDHA/pull/32) | Merged as `01ec0ed` after required CI and actual findings were addressed; final isolation fix peer-reviewed; supplemental CLI attempt gave no coverage | Forced-stage, newline, case, original-policy and fail-closed regressions; actual scan added to required test command |
| Taxonomy-version provenance | Independent; integrated `main` at `475f615` | `020-taxonomy-provenance` / [PR 31](https://github.com/GitCmurf/AIDHA/pull/31) | Merged as `33f40cd`; approved patch and all eleven non-generated blobs unchanged; fresh exact-head CI and actual reporting-bot checks pass | Structured canonical fingerprint; exact Resource metadata after fresh SQLite reopen and email ingestion |
| Email parser dependency maintenance | Verified `main` at `33f40cd`; independent | `021-email-parser-dependencies` / [PR 33](https://github.com/GitCmurf/AIDHA/pull/33) | Merged as `580b94c` from approved `a5d9651`; required CI passes; actual reports assessed | Synthetic malformed-address/mailto tests and ordinary MIME control; no real email |
| Distillation validation and evidence checks | Verified `main` at `580b94c`; independent of model/pipeline wiring | `022-distillation-validation` / [PR 34](https://github.com/GitCmurf/AIDHA/pull/34) | Merged as `1c83ecb` from approved `dd55b43`; exact integrated tree matches; required CI passes | AIDHA-TESTING-056; mechanical acceptance explicitly does not prove semantic entailment |
| Bounded model generation and grounding | Verified `main` at `1c83ecb`; uses PR 34 contracts | `023-distillation-pipeline` / [PR 35](https://github.com/GitCmurf/AIDHA/pull/35) | Merged as `5b81d23` from approved `b08f8ab`; exact tree matches; late Greptile finding has separate correction | TESTING-057; default selection unchanged; no live provider calls |
| Shared grounding source context | Verified `main` at `5b81d23` | `024-grounding-context` / [PR 36](https://github.com/GitCmurf/AIDHA/pull/36) | Merged as `be9876c`; source context remains shared and versioned | TESTING-058; source text once, per-unit citation IDs, cache version bumped |
| Semantic-quality evaluation and improvement | Depends on PR 36 at `f994fa0` | `025-semantic-quality` / [PR 37](https://github.com/GitCmurf/AIDHA/pull/37) | Merged as `27ee9fa`; no production semantic experiment included | Assistant-authored fictional expectations remain provisional, not human gold; controlled scores 6/9, 7/9, 6/9 do not establish improvement |
| Explicit config selection | Verified `main` at `27ee9fa`; independent fail-closed correction | `060-explicit-config-selection` / [PR 56](https://github.com/GitCmurf/AIDHA/pull/56) | Merged as `29424fc` after current-head checks and report assessment | Missing or invalid explicit config selection fails closed; this is a technical correction, not a new product or model default |
| Semantic grounding experiment | Depends on reviewed 024; retain acceptance failures | `026-semantic-grounding` / local hold | No PR or merge request; prompt/kind/link changes remain unproven and separate from the checkpoint | Three fresh-run partials and run-to-run variability; no semantic win claimed |
| Extraction and source distillation | Dependency map pending | Pending | Separate foundational fixes and distillation where contracts permit | AIDHA-PLAN-009, AIDHA-PLAN-010; older reviews require exact-scope checks |
| Activation and continuity | Dependency map pending; mixed commit `b628643` needs deliberate separation | Pending | Pair public CLI, persistence tests and currently uncommitted supporting docs | PLAN-008, PLAN-011, PLAN-014 |
| Reader and evidence navigation | Core extraction/evidence contracts; exact boundaries pending | Pending | Split usable increments from questions, relations and paper discovery | PLAN-012, PLAN-013 |
| Workflow and uncommitted documentation | Independent workflow; remaining docs assigned by feature | `018-landing-workflow` / [PR 28](https://github.com/GitCmurf/AIDHA/pull/28) | Merged as `1cd67f0` after final-head CI; approval recorded | Peer review, inventory validation, strict docs/DocOps pass |
| VTT cue cleanup; rolling deduplication held | Independent `main`; bounded portion of `2aca5ec` + `a4ad4df` | `016-rolling-captions` / [PR 29](https://github.com/GitCmurf/AIDHA/pull/29) | Merged as `475f615` after base refresh and final-head required CI | 47 final parser tests, lint/build/docs/DocOps pass; initial full suite 1061 passed / 7 skipped; reviews assessed |
| Dotenv configuration | Independent `main`; adapted `7e27977` | `017-dotenv-config` / [PR 30](https://github.com/GitCmurf/AIDHA/pull/30) | Merged as `3a38fff` after base refresh and final-head required CI; four fixture false positives documented | 29 CLI + 37 loader tests, lint/build/docs/DocOps and completed reviews; findings assessed |

## First batch completion checklist

- [x] Preserve original edits and verify their content hashes remain unchanged, apart from this
  newly created workflow. Retain private recovery material and the source branch.
- [x] Extract graph, VTT and dotenv changes onto independent branches from verified main.
- [x] Complete precommit local/peer/CLI review and publish PRs 27–30, including workflow PR 28.
- [x] Reproduce the real regressions before fixing them and run each slice's targeted checks.
- [x] Assess initial genuine bot reports and ignore CodeRabbit/Qodo skipped reviews.
- [x] Complete required genuine reporting-bot follow-up fixes; record intentional/deferred limits.
- [x] Confirm code PR final-head CI and workflow CI at the recorded revisions below.
- [x] After owner approval, refresh bases and recheck every latest head immediately before merge.
- [x] Record reviewed PR heads, actual CI links, remaining findings and an owner merge brief.
- [x] Obtain explicit owner approval for the named PRs before merging.
- [x] Merge only the approved first-batch scope, refreshing and revalidating each remaining branch.

Original branch commits are provenance, not a requirement to preserve unsafe behaviour. The
original caption deduplication is held and must not re-enter through a later wholesale copy of
source-branch files. Track improved tests and repaired behaviour as deliberate supersession when
reconciling extracted commits after merges.

## Next batch extraction map

The guard and taxonomy implementations are merged as independent PRs 32 and 31. The ledger
records their evidence and review limits. Remaining entries are extraction plans. Use final
reviewed hunks/files from the
source branch, not wholesale chronological cherry-picks. This map is not completion evidence.

| Order | Cohesive slice / provenance | Dependencies and required work | Verification |
| --- | --- | --- | --- |
| 1 (landed) | Private public-artifact guard; final `fdfa77c` plus safe template from `a0a8363` | Independent runtime slice. Include checker, hook, package script, final runbook/template and regenerated catalog. Replace links to unlanded plans. Never publish the intermediate template's instruction to commit private packets | Checker self-test, public-path guard, secret scan, docs/DocOps; inspect content as well as paths |
| 2 (landed) | Taxonomy-version provenance; selected `f6a3549` hunks plus `000c66e` | Independent six-path slice: assignment schema/tests, classifier service, taxonomy metadata schema hunk, YouTube and email assertions. Do not include the graph routing hunk or activation task writes | Phyla/core/graph/YouTube/email tests; classifier provenance/determinism; lint/build/docs |
| 3 | PLAN-008/TASK-010 planning baseline; `75f4c8d`, `0de6ed3`, `77f6ce3` | Eight-path historical union needs consolidation and current PEPYS wording; regenerate catalog/nav. Meminit config edits from `f6156c0` are separable; its catalog addition is undone by `d838900` | Scoped DocOps, docs validation/render, links and accurate acceptance claims |
| 4 | Generic activation; `f6a3549` plus selected acceptance expansions | Dependency root. Separate read-only query/review/re-entry first. Reconcile Task creation with PEPYS before writes. `de1cb5d`, `b5d7f02`, `921ecf1` invoke task creation and cannot certify a read-only subset unchanged | Focused graph/core/CLI contracts and a public launcher scenario appropriate to the extracted scope |
| 5 | Trace / JSON-LD CLI / source task sharing | Trace `70db052` depends on activation. JSON-LD `2775413` + `d7efe0d` needs activation/store helper and acceptance, independently of trace. YouTube sharing `15cd2b8` waits for the task-write boundary | Graph/core/CLI/acceptance or source tests per slice; lint/build/docs |
| 6 | Readiness and pilot evidence; `a0a8363`, `0b62106`, `20c1971` | Consolidate after finished behaviour; use only the final safe template. Historical ledger closure does not complete the present pilot | Truthful evidence, protected private outputs and public-artifact checks |

The guard checks tracked path names and cannot certify content privacy. The existing strategy
already settles PEPYS authority; do not ask the owner to settle it again. Mixed core `b628643` and
reader `39733e0` remain later thematic extraction work after these foundations are understood.

### Dependency maintenance before real-source pilots

A refreshed 2026-10-16 authenticated Dependabot check at main `33f40cd` found 35 open
alerts, including thirteen reports naming `nodemailer` or `linkify-it`. These counts are a dated
snapshot, not an assessment that all alerts are reachable. There is no production deployment
or users. Raw evidence remains in the local managed security-artifact store. The earlier
32-alert snapshot at `475f615` is superseded.

- [x] Prepare a focused email dependency PR before a real-email pilot. The runtime `mailparser`
  chain invokes the affected address parser and text-link matcher. Prefer a compatible parent
  upgrade and test real parsing boundaries; do not force a major child override blindly.
- [ ] Separately update the bounded configuration/YAML chains after checking the actual used APIs.
- [ ] Update Vitest/build dependencies and documentation tooling in their own reviewed slices;
  GitHub's lockfile runtime labels do not accurately describe every workspace's development use.
- [ ] After each dependency PR, run its relevant malformed-input/functional regressions and the
  required CI, then refresh the alert inventory. Do not claim that version changes alone prove
  exposure is removed. This engineering work needs no new product or spending decision.

### Next functional slice after email maintenance

Prioritize validation and evidence checks for model-generated distillations before activation or
reader expansion. Semantic distillation still requires LLM judgment. The extracted dependency
closure has nine code paths: five core
`extract/distill/` modules (`schema`, `json`, `quote-verification`, `coverage`, `projection`)
and four matching test files; JSON helpers are covered indirectly by schema tests. This slice
also exports the contract functions through core's extraction barrel and adds one composition
test at that package boundary. Core already has Zod and Vitest. Use the self-contained
AIDHA-TESTING-056 acceptance specification; the broader PLAN-010 remains a later docs slice.

Initial provenance is `2d53205`, `880e91c`, `a21026d`, `85faa5b` and `64f1e52`. Final semantics
also require the JSON helper hunks from `d457f16`/`fc404b4`, selected schema/quote trust checks
and matching tests from mixed `b628643`, and the coverage ordering fix from `907f15f`.
Never cherry-pick those mixed commits wholesale. The latest projection comment describes runtime
snapshot wiring outside this slice; revise it to describe policy only before publication.

- [x] Verify the current base and nine-path dependency closure; expose/test the core package API.
- [x] Isolate a self-contained acceptance spec with explicit semantic and runtime limits.
- [x] Test schema/reference integrity, literal quote checks and unknown references, citation
  diagnostics without forced claim counts, and intent/kind/importance routing rules.
- [x] Run core tests, lint/build, docs/DocOps and independent review; publish a separate PR.
- [x] Keep runtime wiring, activation/task writes, continuity and reader UI in subsequent slices.
- [ ] Prove runtime extraction quality only after a separately reviewed miner/pipeline slice.

This foundation supports inspectable reader evidence. It is not itself a user-visible quality win.
Synthetic contract work needs no owner product decision. Existing PEPYS authority remains settled.

## Sprint 2: Prove the reader helps with a real question

- [ ] Use the existing owner question about visceral fat and muscle preservation unless the
  owner selects another live question; prepare the workflow before asking for review.
- [ ] Show answer → claim → study or video → passage, with population, measured outcomes,
  qualifications, missing evidence and shared-study identity visible where known.
- [ ] Connect topic classification or reviewed relationships only where observed retrieval
  failure justifies it; resolve relation direction before using qualification links in synthesis.
- [ ] Have the owner inspect one concrete answer and evidence trail, recording what helped and
  what required checking. Do not require the owner to adjudicate the full corpus.
- [ ] Verify later retrieval and a small application or recall task; distinguish reading from
  understanding and successful use.
- [ ] Compare with ordinary source files/direct-agent assistance on the same question and budget.
- [ ] Record usefulness, correction/reconstruction effort and remaining failure cases. Technical
  tests and model approval alone do not demonstrate owner benefit.

## Sprint 3: Prove continuity on one real project

- [ ] Prepare the existing continuity workflow with synthetic inputs and current public commands.
- [ ] Confirm one bounded real project and permitted inputs; keep PEPYS read-only and authoritative.
- [ ] Produce a brief preserving settled decisions, corrections, ownership, freshness and gaps,
  with one feasible next action and no more than three default attention items.
- [ ] Demonstrate fresh-session recovery and one change without reconstructing the original story.
- [ ] Compare against original notes; retain the simpler route if structured continuity adds effort.
- [ ] Record owner feedback on reduced mental juggling and preserved practical outcomes.

## Sprint 4: Automate the useful workflow

- [ ] Select the workflow demonstrated useful in Sprints 2–3 and verify source/data boundaries.
- [ ] Choose dependable execution and a briefing surface without assuming local WSL is always on.
- [ ] Verify bounded retries/cost, durable checkpoints, freshness, duplicate suppression,
  cancellation and restart/failure recovery.
- [ ] Run a short pilot, proposed duration 14 days, with a brief less/same/more effort check.
- [ ] Continue or expand only when observed usefulness justifies access and maintenance cost.

## Owner decisions and review

| Decision | Needed when | Recommendation and sensible alternatives | Current blocker? |
| --- | --- | --- | --- |
| Merge authority | Before merging a concrete PR | Apply standing authority to reviewed, noncontroversial pure technical changes after final-head checks and actual report assessment; obtain specific authority for reserved product, model, spend, account or private-data decisions | No repeat approval is required for eligible technical PRs; reserved decisions remain owner gates |
| Reader usefulness | After one working answer and evidence trail is ready | Use the existing question; another live question is equally valid | Blocks a claim of owner benefit, not implementation |
| Continuity inputs | Before processing additional private material | One bounded project plus read-only PEPYS snapshot; keep using synthetic material until selected | Blocks the real-input pilot only |
| New disclosure, spending or account integration | Only if necessary for a selected workflow | Prefer existing authorised routes; present concrete scope and cost before asking | No current new request |

## Work notes

### 2026-10-16 — Baseline and start

- Active checkout: `/home/cmf/code/AIDHA`, branch `fix/youtube-llm-remediation`, HEAD `39bea2d`.
- Cached `origin/main` is `eff2087`; directional count is 0 commits unique to that ref and 69
  unique to HEAD. Cached source remote branch is `84647a8`; HEAD is nine commits ahead.
- Committed difference from cached main: 373 files, 41,246 insertions and 650 deletions.
- Initial working tree: 69 modified/untracked status entries, mostly supporting documentation.
  `git status` directory entries can contain several files; this is not a literal file count.
- GitHub exact-head lookup returned no PR. Remote refs still require refresh before extraction.
- Fresh `pnpm docs:build` passed before workflow creation; this does not certify this new file.
- Three read-only audits delegated: commit dependencies, graph-search independence and supporting
  documentation/publication scope. Their conclusions must be checked against the extracted diff.
- User explicitly requested inspection of GitHub review-bot comments before merging; added above.
- No merge, reset, force-push or source-checkout branch change is authorised by this workflow.
  An explicit later merge approval supersedes the merge restriction for its named scope.

### 2026-10-16 — Recovery and extraction bases

- Local recovery directory: `/tmp/aidha-landing-20261016/`. It contains `tracked.patch`,
  `status.txt`, `commits.txt`, copies of 70 edited/untracked files including this workflow, and
  a SHA-256 manifest. Initial manifest hash:
  `3a710cd8b667bdab9d46e4d40af61c658f8d312b0313c626bd7f4145cca32076`.
  These hashes describe the immutable initial snapshot, not subsequent workflow edits.
  This is local recovery material, not a published attachment or replacement for Git history.
- SSH fetch failed with public-key authentication. Native GitHub CLI credential-helper HTTPS
  fetch succeeded without changing remote configuration or copying credentials. Refreshed
  `origin/main` remains `eff2087`; extraction does not depend on stale cached refs.
- Isolated worktrees: `/tmp/aidha-015-graph-search-startup`,
  `/tmp/aidha-016-rolling-captions`, `/tmp/aidha-017-dotenv-config`, and
  `/tmp/aidha-018-landing-workflow`. Each starts from refreshed main and has its matching
  numbered branch. The source checkout stays on its original branch.
- Independent audit confirmed `fee8b23` has no code prerequisite: its three original files
  match main before the patch. First extraction strengthens FTS-unavailable test handling.
- Two additional independent candidates are in preparation: rolling VTT/JSON3 captions
  (`2aca5ec`, `a4ad4df`) and dotenv config propagation (`7e27977`). Each needs fresh tests and
  a separate review. Whole-commit extraction of `b628643` is rejected because it combines
  continuity, qualified evidence, source briefs, CLI and fixtures.
- Publication holds: retain the two full-source evaluation texts locally pending publication
  scope confirmation; generalise owner-specific context before publishing `PRODUCT.md`.
  These holds do not block the independent PRs.
- Scoped DocOps for this workflow passes. Full documentation verification follows updates.

### 2026-10-16 — First slice checks and workflow review

- Graph slice: new regressions fail against main (two expected failures), then all 156 graph
  tests pass with the fix; package lint and build pass. Package-scoped DocOps and strict docs
  build pass. Dynamic SQLite import and FTS availability checks retain existing optional-backend
  behaviour. Fresh deep CodeRabbit review completes with zero findings across all three files.
- Workflow peer review confirms authority and bot gates; clarified internal restart references,
  canonical document IDs and publication status. Added Planning navigation in its isolated PR.
- Recovery snapshot also persists in ignored `reports/branch-landing-20261016/recovery/` under
  the source checkout, so temporary worktrees are not its only copy. Never publish this directory.

### 2026-10-16 — Baseline inventory and first PR

- [Baseline inventory](../55-testing/branch-landing-20261016/inventory.json) assigns every original
  uncommitted file to a feature or publication hold and enumerates all 69 commits in six dependency
  groups (18 foundation/activation, 16 acquisition/quality, 26 distillation, one mixed core, two
  reader bootstrap/CI, six later comparisons/propositions/papers/library). Assignment is not
  readiness; thematic extraction from mixed commits remains unchecked.
- PR 27 is open with exactly three intended files. CI and review-bot inspection are pending.
  CodeRabbit's GitHub status is green but its comment says automatic review was skipped; the
  independent CLI review did complete. Qodo reports inactive subscription. Do not activate billing
  or treat either status as completed bot review. Other running analyzers are still being checked.
- Caption precommit inspection found unsafe deletion of deliberate within-cue repetition. Added
  preservation requirements before publication; retaining ambiguous source speech takes priority
  over text cleanup. This is engineering work, not a request for owner adjudication.

### 2026-10-16 — Bot follow-up and publication checks

- DeepSource flagged an unused constructed store in PR 27's regression. The follow-up now
  asserts search on that instance; all five FTS tests and a completed independent CodeRabbit
  verification pass. Follow-up `1db19c4` is pushed; final-head CI and bot results remain pending.
- Secret-detection hooks correctly challenged high-entropy strings in the public inventory.
  Inspection confirmed they were SHA-256 file checksums. Keep those in the private recovery
  manifest; the published inventory now includes only paths, dispositions and commit metadata.
  No detector rule or baseline has been weakened.

### 2026-10-16 — Owner clarification distinguishes reports from skips

- Some repository review bots use old free-tier configurations and changed eligibility rules.
  The owner's final instruction is to consider actual bot reports, while ignoring skipped reviews
  such as the CodeRabbit and Qodo responses. Do not wait for skipped reviews or change billing.
- Keep completed CodeRabbit CLI/peer reviews and real CI as separate verification. PR 27's final
  revision `1db19c4` passes TypeScript Packages, Docs Check and Secret Scan. DeepSource's genuine
  finding was addressed and its final JavaScript result passes. Skipped bots supply no approval.
  The PR is ready for owner merge review; no merge has occurred.
- Future PRs need inspection of any genuine reporting-bot findings and final-head CI. This
  clarification supersedes earlier work-note language about ignoring all repository bot results.

### 2026-10-16 — Four independent PRs published; genuine reports assessed

- PRs: graph search [27](https://github.com/GitCmurf/AIDHA/pull/27), workflow
  [28](https://github.com/GitCmurf/AIDHA/pull/28), VTT cleanup
  [29](https://github.com/GitCmurf/AIDHA/pull/29), dotenv config
  [30](https://github.com/GitCmurf/AIDHA/pull/30). All target main independently.
- Graph: final-head CI and completed CLI verification pass; its addressed DeepSource thread
  is resolved. Workflow's initial revision passes real CI; a genuine Greptile report correctly
  requests non-Markdown metadata. Added `inventory.json.metadata.yaml` (AIDHA-TESTING-055),
  validated directly against the repository metadata schema. Creation/history is recorded here.
- VTT: removed unsafe deduplication; 1061 full YouTube tests pass, seven skip; 42 focused tests,
  lint/build/docs/DocOps and deep CodeRabbit review pass on initial revision. Genuine Greptile
  reports then identify single-encoded literal loss and minute/second timestamp handling; these
  require test-first follow-up before merge readiness. A DeepSource declaration-style report is
  also being assessed. Passing review alone does not establish source fidelity.
- Dotenv: 29 CLI and 37 loader tests pass, with shell-only values and both precedence modes.
  Review's major environment-loss concern is disproved: the resolver merges process.env with
  policy-selected dotenv entries. A minor test-link concern is addressed with stable repository
  links, since source-code links outside docs fail strict relative-link rendering. Two completed
  CodeRabbit passes and parent review are retained; synthetic fixtures have precise line-level
  secret-scanner annotations rather than a relaxed detector policy.
- Rechecked the initial recovery manifest: every pre-existing edited/untracked file is unchanged.
  Only the newly created workflow differs from its first snapshot. Original checkout stays at
  `39bea2d`; extracted refinements live in their PR worktrees.

### 2026-10-16 — Follow-up fixes published; final CI in progress

- PR 28's sidecar fix `fa8bec6` passes actual CI; its genuine metadata thread is resolved.
- PR 29 follow-up `6017610` fixes escaped literals, both timestamp forms and within-word timing
  without introducing spaces. Four reported cases plus the word-boundary case fail before fixes;
  all 47 final focused tests, package lint/build, docs and scoped DocOps pass. Parent review and
  completed CodeRabbit verification are retained. The prior full suite passed 1061 tests with seven
  skipped; final-head CI reruns the full suite. The original unsafe deduplication remains held.
- Full HTML-reference decoding is an existing limitation, explicitly documented rather than
  expanded into this extraction. The basic references still decode once; unsupported numeric
  references remain visible source text. A later update should use an established decoder and
  source-fidelity tests, rather than grow another hand-written HTML parser.
- PR 30 `7535527` passes actual CI. Four DeepSource static findings are assessed as intentional
  fixture usage: three literal YAML placeholders and a required second `undefined` argument in
  Vitest's stubEnv signature. Reasons are in the PR body; the threads are resolved. The static
  JavaScript status remains red, so do not describe every external status as green. No runtime
  finding remains from those four reports, and no analyzer configuration was weakened.
- No owner decision is needed for these engineering corrections. The remaining owner gate is
  approval to merge the named, verified PRs. The wider 69-commit branch is not yet landed.

### 2026-10-16 — First batch reaches owner review

- Required Actions pass for graph `1db19c4`, dotenv `7535527`, VTT `6017610`, and workflow
  `fa8bec6`. The final workflow progress notes are a later docs-only update: refresh their CI
  before merging rather than treating an earlier head as its certification.
- All required genuine source-fidelity and governance corrections are pushed. The VTT declaration
  warnings are superseded by module-local helpers; Greptile's two source-text findings are fixed.
  The four intentional dotenv fixture reports are documented, assessed and resolved as threads.
- Next batch: prioritise the public-artifact guard with the corrected private-pilot template;
  never land the older template that directs private results into published docs. Then prepare
  cohesive activation/re-entry, trace and export slices in dependency order. Reconcile existing
  graph Task creation with the already-settled PEPYS commitment authority before exposing writes.
  This is engineering reconciliation, not another request to decide which system owns tasks.

Recorded Actions evidence:

- Graph:
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38895084194),
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38895084399),
  [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38895084195).
- Dotenv:
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38896419297),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38896419099),
  [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38896419139).
- VTT:
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38897340485),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38897340402),
  [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38897340333).
- Workflow:
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38896824751),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38896824679),
  [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38896824801).

### 2026-10-16 — Next batch mapped without altering source work

- A read-only audit refined all 18 foundation commits into the executable map above. The first
  two independent candidates are the safe public-artifact guard and a six-path taxonomy-version
  slice. Activation task writes are deliberately excluded until their PEPYS boundary is reconciled.
- This final workflow update records progress and future merge-time checks. The owner merge brief
  is near the top for review; detailed evidence and unfinished work remain below it.

### 2026-10-16 — Explicit approval and merge train start

- Owner instruction: “all approved”. Applies to PRs 28, 27, 30 and 29 in the presented batch;
  future PRs still need their own merge approval after preparation and review.
- PR 28 merged at `2026-10-16T12:41:04Z`, squash commit `1cd67f0`.
- Remaining approved branches include new main through ordinary merge commits, with no force
  push. Stable patch IDs match their approved patches, and runtime/test blob IDs match the
  reviewed heads exactly. Updated heads: PR 27 `62c2048`, PR 30 `029d749`, PR 29 `6e95d2e`.
- Required CI is rerunning. Merge each next PR only after its synchronized head passes and any
  actual new reports are assessed; ignore skipped bot reviews as instructed.
- Next guard and taxonomy slices are being prepared in isolated worktrees 019 and 020. No
  approval to merge either future slice is inferred. Their PRs will carry the workflow checkpoint.

- Approved merge progress: PR 27 landed as `e2459c5` after required checks passed on
  synchronized head `62c2048`. PRs 30 and 29 were refreshed against that main; their stable
  patch IDs and all runtime/test blobs still match the approved revisions.

### 2026-10-16 — Approved first batch merged

- PR 28: `dea401a` → `1cd67f0`; PR 27: `62c2048` → `e2459c5`; PR 30:
  `d64a7c9` → `3a38fff`; PR 29: `3de871b` → integrated main `475f615`.
- Required `build`, `verify` and `gitleaks` passed on every exact merge head. Every refreshed
  runtime/test blob and stable patch ID matched its approved revision. No force push, admin
  override or repository-settings change was used. Actual reporting-bot findings were assessed;
  skipped reviews were ignored. PR 30's four advisory fixture false positives remain documented.
- Final approved VTT checks: [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38903791850),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38903791851),
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38903791835).
- Original checkout remains `fix/youtube-llm-remediation` at `39bea2d`. All 69 original edited
  paths still match their recovery hashes; only this new workflow has changed. The full source
  branch is not yet landed and the remaining inventory still needs reconciliation.
- Guard review reproduced missing forced-stage protection for local configuration, unusual
  filenames and case variants. Required CI must run the real path scan as well as its tests.
  The guard checks filenames; separate content review and secret scanning remain necessary.
- Taxonomy review found ambiguous delimiter hashing. Distinct structured vocabularies must have
  distinct fingerprints, with stable ordering and durable ingestion evidence before publication.

- Post-merge DocOps: the maintained `.specify/scripts/bash/update-agent-context.sh codex` was
  invoked in the isolated guard worktree. It stopped before editing because there is no matching
  `specs/019-private-artifact-guard/plan.md`; this repository uses the governed plans above.
  No stale `specs/` tree exists to prune. The checked-in `.specify/templates/` are unchanged;
  no generated context or template refresh is claimed.

- Integrated main `475f615` passed [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38904241556),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38904241719),
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38904241655).

- Taxonomy provenance published as PR 31 at `83185b7` after a completed 11-file fresh deep
  CodeRabbit CLI review with zero findings, targeted red/green, affected suites, lint/build,
  strict docs and scoped DocOps. Two expected synthetic fixture fingerprints are annotated
  explicitly for detect-secrets; no baseline is weakened. GitHub CI and reporting bots remain
  a separate publication gate. This PR has no merge approval yet.

- Read-only dependency triage mapped the 32 default-branch alerts to five upgrade chains.
  The email parser chain has a concrete input path and is prioritized before the real-email
  pilot. Configuration/YAML, test tooling and docs tooling remain bounded follow-up slices.
  No dependency, account setting or installation was changed by this audit.

- Guard final review: completed fresh deep CLI review on seven files, then verification on all
  eight files including this checkpoint. Confirmed case handling, repository-root enumeration
  and status wording findings are fixed. Local/peer review also covered required-CI integration
  and escaped diagnostics. The final subdirectory regression failed before the root-resolution
  fix; six focused temporary-Git tests now pass, including a repository root ending in a newline.
  The final root-resolution hunk has direct parent review after the CLI verification finding.
- The guard's earlier full isolated suite passed 1,796 tests with seven skips; it predates the
  final guard-only refinements and main synchronization. Final focused tests, lint/build,
  strict docs and scoped DocOps pass. Fresh GitHub CI remains required before merge approval.

### 2026-10-16 — Second batch published for separate review

- PR 32 publishes the guard and this workflow checkpoint. PR 31 at `202bf3a` includes the
  generic CLI persisted-metadata assertion that initial CI exposed. The failure was reproduced
  locally, then all 29 CLI tests passed with the exact expected version. DeepSource's actual
  non-null assertion finding was fixed with an explicit missing-value error; all nine classifier
  tests pass and the thread is resolved. Full 12-file CLI verification completed with zero findings.
- Initial reporting-bot inspection finds no unresolved threads on either PR after those fixes.
  Fresh final-head required CI remains a merge gate. Skipped CodeRabbit/Qodo reports are ignored.
- The preserved source branch is 69 commits ahead and four behind `origin/main`; it is nine ahead
  and zero behind its own remote branch. Squash merges mean these counts are provenance facts,
  not estimates of remaining work. Original edits still need the full slice-ledger reconciliation.
- Next actions: review/approve the two concrete PRs, then finish planning/activation/trace/export
  extraction in dependency order. Prepare bounded dependency maintenance before real-source pilots,
  prioritising email. Demonstrate the real reader question and read-only continuity usefulness
  before expanding automation. Owner merge approval is the only owner gate for this second batch.

- Code-head CI passed for guard `d496cb6` and taxonomy `202bf3a`. This v0.5 checkpoint is a
  subsequent documentation update; its latest required checks must pass before any merge.

- A subsequent actual DeepSource report flagged complexity six in the taxonomy test fixture
  helper. `4021473` uses typed Node assertions in place of branching guards, preserving all
  behavioral checks. All nine classifier tests and core lint pass; the final test-only hunk has
  independent peer review. This follows the zero-finding 12-file CLI verification. Recheck its
  fresh final-head CI and actual reporting-bot status before merge.

- Late actual Greptile report on PR 32: inherited `GIT_INDEX_FILE` may let the synthetic test
  repositories modify a caller's alternate index. Reproduce only in disposable repositories;
  isolate Git environment variables in test subprocesses while preserving the production guard's
  inherited-index behavior. This is an engineering blocker until reproduced, fixed and reviewed;
  do not ask the owner to approve around it.

- The late Greptile finding is confirmed: a failing disposable-caller regression reproduced
  alternate-index byte changes. The fix isolates Git repository-local environment variables in
  fixture initialization, staging and checker subprocesses. The production checker is unchanged
  and still honors the caller's intended index. Seven focused tests now pass, including exact
  preservation of disposable caller index bytes and staged paths. Final review and fresh CI are
  required before the PR returns to owner merge review.

- Final isolation hunk: parent and independent peer review find no further issue. The supplemental
  CodeRabbit CLI attempt was rate-limited (exit one, no completion; service reported a 24-minute
  wait). It provides no review coverage and is not counted as approval. Earlier completed CLI
  reviews remain recorded; the P1 follow-up relies on direct/peer review, red/green preservation
  regression and fresh required CI/reporting-bot checks. No paid capacity or seat change is
  requested. Waiting for a later extra CLI review is optional, not an owner action needed to fix
  the confirmed defect.

### 2026-10-16 — Second batch explicitly approved

- Owner instruction: “both approved”, referring to PRs 32 and 31 in the preceding review brief.
- PR 32 merged as `01ec0ed` from approved head `f0e1403`. All required checks passed and
  current actual reporting-bot findings were resolved; CodeRabbit/Qodo skips were ignored.
- PR 31 must include the merged guard before its own merge under strict branch protection.
  Preserve its approved patch and all non-generated blobs, regenerate the catalog, push normally
  and wait for fresh required CI; inspect any actual new reports before merging.
- This v0.7 execution checkpoint is saved in the preserved source checkout and local verification
  receipts. Main currently contains v0.6 from PR 32. Carry the newer notes into the next appropriate
  slice rather than expanding the approved taxonomy scope or creating a separate status-only PR.

### 2026-10-16 — Second batch merged

- [x] Record explicit approval for PRs 32 and 31.
- [x] Inspect actual final reporting-bot findings and ignore confirmed skipped reviews.
- [x] Merge PR 32 from `f0e1403` as `01ec0ed` with all required checks passing.
- [x] Synchronize PR 31 to the new main without a force push; regenerate the catalog.
- [x] Prove the stable patch ID and every non-generated file blob match approved `4021473`.
- [x] Rerun required CI on synchronized `4ad7e88`; assess actual reports and merge as `33f40cd`.
- [x] Record final integrated-main CI after the merge.

The final main tree matches the exact tree tested on PR 31 before merge. The source checkout
remains `fix/youtube-llm-remediation` at `39bea2d`; all 69 original baseline files retain their
hashes, and the original index has no staged changes. Against `origin/main`, that preserved
source HEAD is now 69 commits ahead and six behind. These counts are not remaining-work estimates.

Post-merge `update-agent-context.sh codex` was invoked again in isolated worktree 020. It stopped
before edits because no matching `specs/020-taxonomy-provenance/plan.md` exists. No stale `specs/`
tree exists to prune; `.specify/templates/` has no changes in this merge train. The governed
workflow remains the handoff source. This tooling mismatch does not block the approved merges.

The latest GitHub push notice reports 35 dependency alerts (21 high, 14 moderate), compared with
the earlier dated 32-alert audit. Refresh the authenticated inventory before dependency work;
these merges do not change dependency versions. Next engineering work remains bounded dependency
maintenance and the remaining planning/activation/trace/export extraction, followed by the reader
and read-only continuity pilots. No owner decision is currently blocking engineering preparation.

- Final integrated main `33f40cd` passed [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/38945958371),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/38945958391),
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38945958449),
  and [Push on main](https://github.com/GitCmurf/AIDHA/actions/runs/38945958064).
  PR 32 merged at `18:10:47Z`; PR 31 merged at `18:15:40Z` on 2026-10-16. Both approved
  merges are complete, with no current owner blocker for the next engineering step.
- The local v0.7 checkpoint passed strict docs build and scoped DocOps in isolation; its test
  copy and generated catalog were restored afterward, leaving the approved worktree clean.
  Recovery, merge receipts, identical-tree/patch proofs and the current workflow copy are retained
  under ignored `reports/branch-landing-20261016/verification/merge2/`. Main retains v0.6 until
  this execution checkpoint accompanies the next appropriate slice.

### 2026-10-16 — Email dependency maintenance in preparation

- Created isolated `021-email-parser-dependencies` from refreshed `origin/main` at `33f40cd`.
  The original source checkout remains untouched apart from this workflow's progress record.
- Traced the public email-file API through `simpleParser` to address parsing and text-link
  generation. Privacy gates run later and do not protect parser CPU. Transport advisories are
  not automatically reachable through local MIME import.
- Selected upstream `mailparser` 3.9.40 with its supported child versions, rather than forcing
  major transitive overrides. Preserve MIME decoding, thread identity and attachment metadata.
- Both synthetic regressions exceed fifteen seconds on the baseline dependency. On the scoped
  upgrade, all fourteen email tests pass, including the MIME control and pipeline persistence.
  Build/type-check, strict docs and scoped DocOps pass. Fresh independent candidate review finds
  no reportable issue and also checks base64-encoded mailto text through the public parser.
- Completed deep CodeRabbit CLI review covers all eight files. Its one minor finding about
  deletable branch links is fixed with permanent-commit test links. The
  incremental follow-up reused cached results and provided no fresh review coverage.
- Registry audit returns no advisories for the email parser chain; it still exits nonzero with
  twenty-one unrelated advisories in configuration/build-tool chains. This is not a clean-repo
  audit or a claim that every remaining alert is reachable. Keep those updates separate.
- Full workspace build and owning-package lint pass. Core has 139 passing tests and CLI has
  twenty-nine; together with fourteen email tests, 182 affected-package tests pass locally.
- Rechecked all 69 original baseline files against the immutable manifest: unchanged, with this
  newly created workflow excluded. No source-checkout staging or branch change occurred.
- Published [PR 33](https://github.com/GitCmurf/AIDHA/pull/33) at `c5eb2f7`, targeting `main`.
  It has exactly the eight intended files. The follow-up is this documentation checkpoint.
  Final-head required CI and actual reporting-bot assessment remain pending.

Email slice completion record:

- [x] Trace the boundary and independently investigate compatibility.
- [x] Prove both regressions fail on the old dependency and pass on the scoped upgrade.
- [x] Preserve ordinary MIME behavior and run 182 affected-package tests, lint and workspace build.
- [x] Complete independent candidate and eight-file CodeRabbit reviews; fix the confirmed finding.
- [x] Pass scoped DocOps, strict docs, hooks and original-file preservation checks.
- [x] Commit, push and open PR 33 with the exact intended file list.
- [x] Verify latest-head required CI and assess actual reporting-bot findings.
- [x] Prepare the concrete owner merge brief for PR 33.
- [x] Obtain separate owner approval for PR 33.
- [x] Merge after approval, refresh advisory evidence and record the result.
- A read-only remaining-work audit recommends the deterministic distillation contracts next,
  ahead of broader activation/continuity changes. Its follow-up corrected the dependency closure
  to include the JSON helper and later trust/coverage fixes, with runtime wiring held.
  Owner review of a real reader result and
  private continuity inputs remain later gates, not blockers on these engineering slices.

### 2026-10-16 — PR 33 reporting-bot follow-up

- Qodo reports an inactive subscription and CodeRabbit's GitHub bot reports skipped automatic
  review. Ignore both skips; do not activate billing. Macroscope also skips.
- DeepSource reports three minor findings. Applied its function-expression and template-literal
  style suggestions without changing the synthetic regression inputs or parser behavior.
- Its third finding treats the `.mjs` child fixture as a non-module and rejects `import`.
  Native `node --check` accepts it; the focused tests execute that same module successfully.
  This is an analyzer source-type false positive. No analyzer configuration or detector is weakened.
  Disclose any remaining red advisory JavaScript status rather than claiming all checks pass.
- Required final-head CI and inspection of further genuine bot reports remain gates before
  owner merge review. The PR remains open and has no merge approval.

### 2026-10-16 — PR 33 documentation link check

- Required TypeScript verification passes at `e769579`; the separate docs job reports two failing
  links. The review correction pointed at new test files on main before they were merged.
  Pin those acceptance links to existing commit `e769579` instead, so they work before merge
  and survive deletion of the feature branch. Run the actual external link check as well as
  strict docs build before pushing this correction.

### 2026-10-16 — PR 33 reaches owner merge review

- Final PR head `a5d9651c44e0523787c594dc51852704bd2a075f`, base
  `33f40cdb7b90c82ff39600bf2edb4018e29788e2`. The isolated branch is four commits ahead
  and zero behind `origin/main`; its working tree is clean. The original branch remains preserved.
- All required checks pass: [TypeScript verify](https://github.com/GitCmurf/AIDHA/actions/runs/38977198723/job/117229393574),
  [Docs build](https://github.com/GitCmurf/AIDHA/actions/runs/38977198787/job/117229393404),
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/38977199036/job/117229394633).
  CodeQL and DeepSource Python/Shell/Secrets also pass. JavaScript remains advisory red for
  the documented module-syntax false positive; all three actual review threads are resolved.
- The two acceptance URLs were verified HTTP404 on main and HTTP200 at the published commit.
  All 54 external URLs, strict docs build and hooks pass after that correction.
- PR 33 is open and unmerged, awaiting its own owner approval. No paid review, bot reactivation,
  private input or account change was requested. The original 69 baseline files remain preserved.
- This local v0.9 execution checkpoint accompanies the next appropriate slice. PR 33 contains
  validated v0.8 and its PR body has the final CI/review receipt; preserve its tested head while
  awaiting approval rather than opening a status-only PR.

### 2026-10-17 — PR 33 approved and merged

- Owner instruction: “approved”, referring to PR 33 in the preceding merge brief. The approval
  covers this named PR, not future slices. Rechecked current head, all required checks and actual
  reporting-bot threads immediately before merging. No new findings appeared.
- Squash-merged unchanged `a5d9651c44e0523787c594dc51852704bd2a075f` as
  `580b94cc72b8be408c5d7e3b44da7e2654218a54` at `2026-10-17T08:45:20Z`, using the exact-head
  guard and normal branch protection. No admin bypass, force push or settings change occurred.
- Refreshed `origin/main`. Its tree `1e48d3bde924719d27f08d65324341e7c1d6923e` equals the approved
  PR head tree. The original source checkout remains preserved at `39bea2d`; all 69 baseline
  file hashes are unchanged and its index is unstaged. Against `origin/main`, that source HEAD
  is 69 commits ahead and seven behind. These counts are not remaining-work estimates.
- Fresh GitHub alert inventory: 22 open, 15 high and seven medium. None names `mailparser`,
  `nodemailer` or `linkify-it`; the thirteen email-chain alerts from the prior snapshot are no
  longer open. Other chains, including one documentation-tool alert, remain separate work.
- Required post-merge `update-agent-context.sh codex` stops before edits because the expected
  `specs/021-email-parser-dependencies/plan.md` is absent. No `specs/` tree exists to prune and
  `.specify/templates/` has no changes in this merge. This known tooling mismatch does not
  block the completed merge; the governed workflow remains the handoff source.
- Integrated-main CI passes: [TypeScript Packages](https://github.com/GitCmurf/AIDHA/actions/runs/39018555922),
  [Docs Check](https://github.com/GitCmurf/AIDHA/actions/runs/39018555993),
  [Secret Scan](https://github.com/GitCmurf/AIDHA/actions/runs/39018555947),
  and [CodeQL](https://github.com/GitCmurf/AIDHA/actions/runs/39018555833).
- The v0.10 checkpoint passes strict docs build, scoped DocOps and Markdown lint in isolation.
  Restore the temporary workflow/catalog copy afterward; retain the original checkpoint locally.
- Next functional slice remains the nine-path deterministic distillation contracts. Continue
  configuration/build/documentation dependency maintenance separately before relevant real pilots.
  No owner decision currently blocks either synthetic engineering path.
- This local v0.10 execution record accompanies the next appropriate slice. The merged PR has
  validated v0.8. Do not mutate the preserved source checkout or create a status-only PR.

### 2026-10-17 — Validation and evidence checks in preparation

- User clarified that deterministic code cannot replace semantic distillation. The model still
  interprets sources; this slice validates output structure, literal quotations, citation metrics
  and fixed routing. A copied quotation can accompany a contradictory claim; tests preserve that
  distinction. The broader model pipeline remains separate.
- Created isolated `022-distillation-validation` from refreshed main `580b94c`. Dependency versions
  are unchanged. The original checkout and private source material remain preserved.
- Extracted the nine-path module/test closure plus core's public extraction exports and a new
  composition test. Retain PLAN-010 outside this PR and introduce self-contained TESTING-056.
  TESTING-055 is already allocated to the landing inventory sidecar.
- Red-green checks establish each new schema, quote, coverage and routing boundary. Six additional
  regressions reproduce citation inflation and interval errors in the source implementation;
  the corrected diagnostics count only known literal matches and subtract cited time intervals.
  An empty-excerpt generation schema now fails explicitly instead of emitting an empty enum.
- Package verification, independent review, documentation checks and PR publication are in progress.
  No owner decision currently blocks preparation. Merge approval will be separate for the new PR.

### 2026-10-17 — Validation slice review corrections

- Independent review identified two P2 quotation-boundary defects: decimal punctuation and
  supplementary Unicode letters could allow partial spans. Six reproduced failures now pass;
  ordinary signed-number and Unicode controls remain accepted. The bounded independent recheck
  finds no surviving reported issue.
- Completed fresh deep CodeRabbit review covered all fifteen initial files and found one minor
  JSON-fence issue. Three regressions reproduce valid JSON rejection; object-first, language-aware
  fence handling fixes it. Fresh verification review completes with zero findings over all sixteen
  final files.
- All seventy contract tests pass. The final frozen-candidate workspace build/core checks are
  running. A built-package smoke also confirms access from the email consumer workspace.
- Strict docs, scoped DocOps, external link check (61 URLs), secret/public-path hooks, Markdown
  lint and spelling checks pass. Add only the valid plural `theses` to the existing spelling list;
  no secret detector or public-artifact policy is weakened. Dependencies and lockfile are unchanged.
- All 69 preserved baseline files remain byte-identical and the original index is unstaged.
  The full model pipeline and real-source semantic evaluation remain future slices.

### 2026-10-17 — PR 34 published and reporting-bot follow-up

- Published [PR 34](https://github.com/GitCmurf/AIDHA/pull/34) from `dc6b5ac` against `580b94c`,
  with exactly sixteen reviewed files. The full workspace build, all 209 core tests, seventy
  focused contract tests and the final built-package consumer smoke pass locally.
- Fresh deep CodeRabbit verification covers all sixteen files, completes with zero findings
  and has no uncovered files. Independent recheck confirms the JSON/numeric/Unicode fixes.
- DeepSource produced twelve actual reports. Addressed regex Unicode flags, a forward reference,
  non-null assertions and a wildcard test import. Separate the unchanged temporal sweep from
  citation counters to improve reviewability; all behavioral tests remain the acceptance boundary.
- Six complexity reports are advisory maintenance signals, not reproduced correctness defects.
  Explicit parser/reference/boundary checks and the exhaustive routing-table test retain branches
  that are covered by regressions and independent interval checks. Assess any remaining metrics
  after the follow-up; do not weaken analyzer thresholds or split predicates only to hide counts.
- Required published-head CI and inspection of further actual bot findings remain gates before
  owner merge review. Skipped review bots provide no coverage. No new merge approval exists.

### 2026-10-17 — Actual Greptile findings reproduced and corrected

- Greptile produced two actual correctness reports. Quotations could stop inside contractions,
  and JSON extraction used the final prose brace rather than the object's boundary. Eight red
  cases reproduce both defects before correction.
- Quotation boundaries now reject either side of apostrophes joining word characters, including
  straight, curly and compatibility variants. Complete contractions and surrounding quotation
  marks remain accepted. JSON extraction tracks nested braces and string escapes, skipping
  balanced non-JSON prose placeholders before the first valid JSON object.
- These are mechanical correctness fixes; neither establishes semantic entailment. Independent
  review and refreshed package/docs checks precede another push. Final-head CI and actual reports
  remain merge-readiness gates; earlier-head passes do not replace them.

### 2026-10-17 — PR 34 final checks and owner gate

- Final head `dd55b43` differs from fully tested `58969c2` only by two equivalent template-literal
  expressions in a test. All 221 core tests and 82 contract tests pass; final required CI passes.
- Required jobs: [build](https://github.com/GitCmurf/AIDHA/actions/runs/39026928782/job/117379665330),
  [verify](https://github.com/GitCmurf/AIDHA/actions/runs/39026928943/job/117379665994), and
  [gitleaks](https://github.com/GitCmurf/AIDHA/actions/runs/39026928787/job/117379665196).
- Eight red cases establish the two Greptile fixes. Independent review confirms seventeen rejected
  contraction fragments, seventeen valid quotation controls and fourteen JSON controls. DeepSource
  style issues are fixed; remaining complexity reports are assessed maintenance advisories.
- Keep receipts in ignored `reports/branch-landing-20261016/verification/distillation022/`.
  No credentials, private source or paid-review activation is part of this slice.
- The source checkout remains on `fix/youtube-llm-remediation` at `39bea2d`, with its index unstaged
  and all 69 baseline paths unchanged. This local v0.12 completion record accompanies the next
  appropriate slice; the PR retains its reviewed v0.11 record. Do not create a status-only PR.
- No PR 34 merge approval has been received. The concrete owner decision is approval of this
  named PR; no product, spending or account question blocks the prepared engineering work.

### 2026-10-17 — PR 34 approved merge and next slice

- Owner approved merging PR 34 and continuing. Refreshed main/head, all three required checks
  and all twenty-one actual review threads immediately before merging the approved `dd55b43`.
  GitHub merged it as `1c83ecb`; a tree comparison confirms exact equality with the tested head.
- Created isolated `023-distillation-pipeline` at that merge. The source checkout remains preserved.
  The next bounded slice extracts generation, one schema repair, literal checks, advisory semantic
  grounding and draft projection. It uses the existing injected LLM client and production runtime.
  Consolidation, quotation reselection, large-source notes and default selection stay separate.
- Before copying, the dependency audit found that the original miner imports quote catalogs and
  claim identity through those later passes. Trim those dependencies rather than importing the
  larger bundle. Preserve PR 34's corrected validators. The new acceptance spec is TESTING-057.
- Runtime acceptance must include exact rejected/supporting outputs, cache isolation by miner/model,
  retry after failed extraction, and truthful token usage after later thrown calls. Synthetic tests
  demonstrate orchestration, not semantic model accuracy. No live provider call is authorised here.
- Agent-context refresh was attempted after the merge and stopped before edits because
  `specs/023-distillation-pipeline/plan.md` is absent. This repository has no feature-spec tree;
  the governed acceptance document and this workflow retain the handoff. No template change is needed.

- Integrated main `1c83ecb` passes TypeScript Packages, Docs Check, Secret Scan and Push on main.
  The context-refresh limitation above remains recorded; no generated context file was changed.
- Meaningful runtime regressions reproduced lost supporting/rejected reports, cross-miner/model
  cache reuse and failed extraction cache poisoning. Those cases pass after report propagation,
  explicit cache identities and failed-run exclusion. Independent review additionally identified
  CLI summary loss, unresolved support links and completion-only budgeting; fixes and regressions
  are being completed before publication. TESTING-057 documents the bounded behavior and limits.

- The 023 slice passes all 270 core tests, including 49 added host/runtime tests. Its complete
  workspace build, owning core lint, strict docs and scoped DocOps pass. Two public CLI regressions
  reproduce lost failure status and lost qualified metadata before the shared mapper fix.
- Peer review found four issues and the scoped fixes are implemented: estimated prompt input is
  reserved before completion budgets; unresolved proposed links remain separate from live links;
  anonymous miners bypass cache; public CLI summaries retain failure and qualified reports.
  Tokenisation remains approximate, and unsupported dollar ceilings fail before provider calls.
- Fresh independent recheck finds no surviving material issue in the three core corrections;
  the CLI correction has parent review and public-entrypoint regressions. Whole-slice external
  review and final affected-package checks precede commit and publication.

- Fresh deep CodeRabbit review completed over all twenty files with one minor finding: one invalid
  grounding verdict discarded valid rejections elsewhere in the same response. The mixed-response
  regression reproduced two exported drafts instead of one. Per-entry verdict parsing now retains
  valid rejections and bounded entry diagnostics; malformed entries use the existing missing-verdict
  policy. Verification review and refreshed affected checks follow this correction.

- A final real-exporter check reproduced same-text qualified drafts overwriting one graph node.
  Distillation-only IDs now include source meaning and evidence, while excluding model/prompt
  versions and generated unit numbering. Legacy IDs are unchanged. Regression cases check distinct
  qualifications and citations, exact stored metadata and stable IDs after a fresh model run.
- CodeRabbit verification completed with one further minor finding: missing usage on the final
  advisory grounding call incorrectly discarded verified drafts under a token allowance. Two red
  cases reproduce it. Usage uncertainty now blocks a later call, while the final advisory result
  retains untrusted drafts and the accounting diagnostic. These final corrections receive bounded
  independent review and affected checks before publication.

- Bounded independent review finds no surviving material issue in the final identity and usage
  corrections. All 136 focused tests pass. Both completed twenty-file CodeRabbit reviews produced
  genuine minor findings, now fixed with regressions; the last corrections have peer review rather
  than a claimed zero-finding CLI receipt. Final owning checks and repository CI remain gates.

### 2026-10-17 — PR 35 reaches owner merge review

- Published PR 35 from `f83b4f5` against `1c83ecb`; final convention follow-up is `b08f8ab`.
  Exactly twenty files remain in scope. Required final-head CI passes:
  [build](https://github.com/GitCmurf/AIDHA/actions/runs/39031744891/job/117393414493)
  [verify](https://github.com/GitCmurf/AIDHA/actions/runs/39031744925/job/117393414602)
  [gitleaks](https://github.com/GitCmurf/AIDHA/actions/runs/39031744872/job/117393414424).
- All 275 core and 31 CLI tests pass on the functional candidate; the small helper and exhaustive switch
  follow-up passes owning typechecks, ten report tests and two public CLI tests.
  The final built-package public ingestion smoke makes two synthetic model calls and returns an
  untrusted draft with literal evidence and an explicit successful distillation status.
- Actual DeepSource findings are assessed in the PR. Retained complexity/async-fake advisories are
  disclosed, convention fixes are pushed, and no paid-review activation or suppression is used.
  Any later report must be checked again before merging. Skipped reviews supply no coverage.
- Keep private receipts in ignored `reports/branch-landing-20261016/verification/distillation023/`.
  This validated local v0.14 completion record accompanies the next appropriate slice; PR 35
  retains reviewed v0.13. Do not create a status-only PR or alter the preserved source index.
- The source remains at `39bea2d` on `fix/youtube-llm-remediation`, with all 69 baseline files
  unchanged. PR 35 has no merge approval yet; do not extend PR 34's approval to this new PR.

### 2026-10-17 — PR 35 approval and quality sprint

- Owner approved PR 35 and explicitly prioritized semantic-quality improvement. Approved head
  `b08f8ab` merged as `5b81d23`; fetched main has exactly the same tree.
- Late Greptile thread `discussion_r4302631283` reproduces repeated grounding context. The failed
  review gate did not stop the subsequent shell command. Record the error and use explicit
  dependent-call success gates going forward. A separate 024 correction is being reviewed.
- 025 freezes three new public synthetic cases before calls; native Claude authentication uses
  the existing subscription. Expectations are assistant authored and not human adjudicated.
  Keep extraction/grounding source-only; store full generated and persisted outputs for review.

### 2026-10-17 — Context correction and measured semantic checkpoint

- PR 36 is ready at `f994fa0`: six files, all 276 core tests, strict docs, scoped DocOps, hooks,
  independent review and a completed zero-finding six-file CodeRabbit review pass. Final required
  CI, CodeQL and all four DeepSource analyzers pass. GitHub skips supply no coverage.
- PR 35 main CI passes all four workflows. The context helper exits before edits because this
  extraction branch has no legacy `specs/.../plan.md`. No spec/template change is fabricated.
- Freeze nine provisional semantic expectations and fourteen forbidden distortions across three
  public fictional sources. The first native-CLI prototype omits schema controls; its candidate
  fails after one repair invents a condition type. Preserve it as an exploratory failure.
- A schema-forwarding adapter is regression-tested, after its first attempt exposes a native
  schema-dialect incompatibility. Only the rejected dialect URI is removed; constraints and
  authoritative host parsing remain. Controlled baseline and candidate both use the same
  pinned `claude-sonnet-5-5` and low effort. CLI invocation counts are not provider-call caps.
- Controlled baseline: six required items met, three partial, none missed, no listed forbidden
  distortion. The remaining losses detach qualifiers; additional observed issues are a redundant
  preliminary queue result and an irrelevant UI support link. TESTING-059 records the rubric,
  source-only production-runtime seam, limits and subsequent comparison. No private source is sent.

### 2026-10-17 — Separate the stable checkpoint from unstable semantic changes

- Controlled baseline meets six of nine provisional criteria. The first controlled semantic
  experiment meets seven; a fresh expanded experiment returns to six. None passes the recorded
  nine-item bar. Keep exploratory schema failures, intermediate results and the partial frozen
  grounding replay; do not select an attractive output and claim a reliable improvement.
- Publish only stable runners, synthetic corpus, reviewed snapshots, offline CI checks and
  TESTING-059 from `025-semantic-quality` at `/tmp/aidha-025-semantic-checkpoint`. It depends on
  PR 36. Production prompt/schema/default contracts are unchanged in the checkpoint.
- Retain all experimental prompt/kind/link changes uncommitted on `026-semantic-grounding` at
  `/tmp/aidha-025-semantic-quality`. No experiment PR or merge approval is requested.
- Next semantic slice: validate typed limitation applicability with the relevant source passages,
  attach each limitation to its exact target, preserve origin/tester roles, and measure repeated
  plus held-out behavior. A structurally valid relation is not semantic evidence. Existing
  consolidation proposals omit source evidence and permit overly broad `limits` attachment;
  these need correction during extraction rather than wholesale reuse from the preserved branch.
- Then prove that qualified claims and review dependencies survive SQLite close/reopen and
  query/brief retrieval. Use two similar fictional results, a later limitation affecting only one,
  and an unnamed source origin; assert exact target, evidence, roles and propagated review state.
  The original brief checks limitation dependencies while generic activation retrieval can omit
  a later check on the limiting assertion. Keep this follow-on boundary explicit.
- The owner is not blocking semantic implementation. Named PR merge decisions remain separate;
  optional review of one concrete queue/supplier result can calibrate the provisional rubric.

### 2026-10-17 — Current model inventory and actual checkpoint bot follow-up

- The owner's Microsoft/OpenAI recollection is confirmed by their official documentation.
  Record the decision-only comparison above before further held-prompt tuning. Preserve a
  refreshed strong generative baseline for distillation and repair, with decisions evaluated
  separately by task. No hosted live comparison or new spending is authorised by this note.
- PR 37's first head `ae0854b` passes build, verify, gitleaks and all four DeepSource analyzers.
  CodeRabbit GitHub and Qodo skip and supply no coverage. A later actual Greptile finding
  identifies failed native replies losing returned content and usage; initial green CI does
  not supersede the finding. The error-reply and missing-structured-result regressions fail
  before the fix and pass after complete reply/usage capture moves before those checks.
- Final-head CI, independent correction review and a fresh report/thread inspection remain
  required before owner merge readiness. PR 36 still needs its own approval. Neither the
  checkpoint nor the model inventory demonstrates semantic improvement.

- The first correction head passes package tests, secret scanning and all four analyzers, but
  Docs Check fails four URLs. The unchanged link checker includes a semicolon after a Markdown
  link in the URL. Correct the five affected link separators; all 77 URLs then pass unchanged
  link checking, and strict docs still builds. Retain the failed CI receipt and rerun final CI.

## Offline decision checkpoint integration

PR 38 adds the separate category and evidence-judgment checkpoint specified in
[AIDHA-TESTING-060](../55-testing/testing-060-decision-quality.md).
It measures the actual classifier's persisted assignments and prepares source-only requests
and saved-receipt replay. Its public labels are assistant-authored provisional examples,
not human gold. No model is called, ranked or selected by this offline slice.

Current integration retains the merged runtime floor, dependency fixes, exhaustive serial
workspace dispatch and existing semantic-quality preflight. The decision-quality preflight
is added explicitly and protected by the root-script contract. Historical candidate snapshots
on the older branch do not replace the standing technical authority or extend the separate
model, product, private-source, account and spending gates above.
