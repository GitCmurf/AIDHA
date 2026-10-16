---
document_id: AIDHA-PLAN-015
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-10-16
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
> **Version:** 0.3
> **Last Updated:** 2026-10-16
> **Type:** PLAN

# Branch Landing and Next Sprints Workflow

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-16 | Codex | Record the authorised extraction, review and PR workflow, subsequent outcome-focused sprints, owner gates and restart notes. | — | Draft | Owner request |
| 0.2 | 2026-10-16 | Codex | Distinguish skipped bot reviews from actual reports; retain genuine findings, CI and completed peer/CLI review gates. | CMF | Draft | Owner clarification |
| 0.3 | 2026-10-16 | Codex | Publish the first independent PR batch, record assessed review findings, and add inventory sidecar metadata. | — | Draft | PRs 27–30 |

## Purpose and authority

Separate accumulated work into coherent, independently verified PRs and land it in dependency
order. Then establish whether the reader and continuity workflows reduce the owner's effort.
This file is the execution checklist and handoff record; it does not replace PEPYS commitment
authority. Check items only when evidence exists. Keep unfinished work and limitations visible.

The owner authorises local preparation, fixes, delegation, code review, pushing relevant branches
and opening PRs. Existing CodeRabbit permission applies to this repository. Exclude credentials
and private runtime material from external review and publication. Do not merge without explicit
owner approval. Additional spending and new private-source destinations require specific authority.

The owner clarified that some repository review bots use older free-tier configurations and
now skip under changed eligibility criteria. Ignore skipped reviews (including CodeRabbit and
Qodo skips); do not wait for them, count a skipped-success status as approval, trigger paid work
or reactivate subscriptions. **Consider bots that actually produce reports or findings.** Inspect
those reports and resolve confirmed issues before merging. Actual build/test/docs/secret-scan CI
and completed local, peer or explicitly requested CLI reviews remain separate evidence. A completed
CodeRabbit CLI review is distinct from a skipped CodeRabbit GitHub bot review.

## Owner merge brief for the first batch

Recommendation: approve PR 28 (workflow), PR 27 (graph), PR 30 (dotenv) and PR 29 (VTT).
They are independent of the large unfinished reader/core changes. Approval can name all four or
individual PRs; no merge is inferred from preparation or publication. The source branch remains
preserved. The full landing sprint is still open.

| PR | Reviewed code / documentation revision | Evidence and review limit | Merge risk |
| --- | --- | --- | --- |
| [28 — workflow](https://github.com/GitCmurf/AIDHA/pull/28) | `fa8bec6` plus subsequent progress notes | CI passes at recorded revision; sidecar schema and peer review pass. Recheck CI for any later notes | Docs and navigation only |
| [27 — graph](https://github.com/GitCmurf/AIDHA/pull/27) | `1db19c4` | 156 graph tests, focused follow-up, completed CodeRabbit review/verification; required CI passes | Startup count fix; missing-row check, not full index audit |
| [30 — dotenv](https://github.com/GitCmurf/AIDHA/pull/30) | `7535527` | 29 CLI / 37 loader tests, review/verification and required CI pass. Four static fixture false positives are documented | Three-line resolver forwarding change; no credentials or account changes |
| [29 — VTT](https://github.com/GitCmurf/AIDHA/pull/29) | `6017610` | 47 final focused tests, prior 1061-test package run, completed reviews and final required full CI pass | Safe cue cleanup; full HTML decoding and ambiguous deduplication stay separate |

Read-only branch-protection inspection confirms required checks are `build`, `verify` and
`gitleaks`, with strict up-to-date enforcement. After each approved merge, refresh every remaining
PR against the new main, regenerate affected docs indices, verify unchanged intended scope and
rerun required CI before the next merge. Do not bypass checks or change repository settings.
DeepSource's four assessed fixture warnings on PR 30 are advisory rather than required checks;
the red JavaScript status must remain disclosed unless its reporting service is corrected.

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
- [ ] Present a concise merge brief to the owner; obtain explicit approval before merging.
- [ ] After an approved merge, refresh dependent bases, revalidate and update the ledger.

The repeated checklist is a template. Each slice needs its own stage/evidence entry in the ledger;
checking the template once does not establish completion for every PR. Prefer independent PRs
against `main`; use dependency-ordered or stacked PRs when separation would otherwise break a
contract. Do not split tightly coupled code merely to reduce file counts or rewrite the source
branch to make an extraction appear complete.

### Sprint completion

- [ ] Every original commit and uncommitted path is accounted for as landed, superseded with
  evidence, or retained with an explicit reason and next action.
- [ ] No private runtime evidence has entered published paths or PRs.
- [ ] Owner-approved merges are complete and the integrated base passes required checks.
- [ ] Deferred product requirements remain in the subsequent sprint checklist.

## Slice ledger

Supporting document IDs refer to the preserved source checkout until their owning slices land.
Do not introduce links to pages absent from a PR base.

| Slice | Base / dependencies | Branch / PR | Stage and next action | Evidence / findings |
| --- | --- | --- | --- | --- |
| Graph search startup optimisation | Verified `main` at `eff2087`; independent | `015-graph-search-startup` / [PR 27](https://github.com/GitCmurf/AIDHA/pull/27) | Pushed; actual CI passes at `1db19c4`; owner merge approval pending | 156 tests, lint/build/docs/DocOps and completed deep CodeRabbit review pass |
| Extraction and source distillation | Dependency map pending | Pending | Separate foundational fixes and distillation where contracts permit | AIDHA-PLAN-009, AIDHA-PLAN-010; older reviews require exact-scope checks |
| Activation and continuity | Dependency map pending; mixed commit `b628643` needs deliberate separation | Pending | Pair public CLI, persistence tests and currently uncommitted supporting docs | PLAN-008, PLAN-011, PLAN-014 |
| Reader and evidence navigation | Core extraction/evidence contracts; exact boundaries pending | Pending | Split usable increments from questions, relations and paper discovery | PLAN-012, PLAN-013 |
| Workflow and uncommitted documentation | Independent workflow; remaining docs assigned by feature | `018-landing-workflow` / [PR 28](https://github.com/GitCmurf/AIDHA/pull/28) | Sidecar fix pushed at `fa8bec6`; real CI passes; owner merge approval pending | Peer review, inventory validation, strict docs/DocOps pass |
| VTT cue cleanup; rolling deduplication held | Independent `main`; bounded portion of `2aca5ec` + `a4ad4df` | `016-rolling-captions` / [PR 29](https://github.com/GitCmurf/AIDHA/pull/29) | Follow-up `6017610` passes required CI; owner merge approval pending | 47 final parser tests, lint/build/docs/DocOps pass; initial full suite 1061 passed / 7 skipped; reviews assessed |
| Dotenv configuration | Independent `main`; adapted `7e27977` | `017-dotenv-config` / [PR 30](https://github.com/GitCmurf/AIDHA/pull/30) | Pushed at `7535527`; real CI passes; four fixture false positives documented | 29 CLI + 37 loader tests, lint/build/docs/DocOps and completed reviews; findings assessed |

## First batch completion checklist

- [x] Preserve original edits and verify their content hashes remain unchanged, apart from this
  newly created workflow. Retain private recovery material and the source branch.
- [x] Extract graph, VTT and dotenv changes onto independent branches from verified main.
- [x] Complete precommit local/peer/CLI review and publish PRs 27–30, including workflow PR 28.
- [x] Reproduce the real regressions before fixing them and run each slice's targeted checks.
- [x] Assess initial genuine bot reports and ignore CodeRabbit/Qodo skipped reviews.
- [x] Complete required genuine reporting-bot follow-up fixes; record intentional/deferred limits.
- [x] Confirm code PR final-head CI and workflow CI at the recorded revisions below.
- [ ] After owner approval, refresh bases and recheck every latest head immediately before merge.
- [x] Record reviewed PR heads, actual CI links, remaining findings and an owner merge brief.
- [ ] Obtain explicit owner approval for the named PRs before merging.
- [ ] Merge only the approved scope, refresh bases and revalidate downstream slices.

Original branch commits are provenance, not a requirement to preserve unsafe behaviour. The
original caption deduplication is held and must not re-enter through a later wholesale copy of
source-branch files. Track improved tests and repaired behaviour as deliberate supersession when
reconciling extracted commits after merges.

## Next batch extraction map

All entries below remain unimplemented as extracted PRs. Use final reviewed hunks/files from the
source branch, not wholesale chronological cherry-picks. This map is planning evidence, not
completion evidence.

| Order | Cohesive slice / provenance | Dependencies and required work | Verification |
| --- | --- | --- | --- |
| 1 | Private public-artifact guard; final `fdfa77c` plus safe template from `a0a8363` | Independent runtime slice. Include checker, hook, package script, final runbook/template and regenerated catalog. Replace links to unlanded plans. Never publish the intermediate template's instruction to commit private packets | Checker self-test, public-path guard, secret scan, docs/DocOps; inspect content as well as paths |
| 2 | Taxonomy-version provenance; selected `f6a3549` hunks plus `000c66e` | Independent six-path slice: assignment schema/tests, classifier service, taxonomy metadata schema hunk, YouTube and email assertions. Do not include the graph routing hunk or activation task writes | Phyla/core/graph/YouTube/email tests; classifier provenance/determinism; lint/build/docs |
| 3 | PLAN-008/TASK-010 planning baseline; `75f4c8d`, `0de6ed3`, `77f6ce3` | Eight-path historical union needs consolidation and current PEPYS wording; regenerate catalog/nav. Meminit config edits from `f6156c0` are separable; its catalog addition is undone by `d838900` | Scoped DocOps, docs validation/render, links and accurate acceptance claims |
| 4 | Generic activation; `f6a3549` plus selected acceptance expansions | Dependency root. Separate read-only query/review/re-entry first. Reconcile Task creation with PEPYS before writes. `de1cb5d`, `b5d7f02`, `921ecf1` invoke task creation and cannot certify a read-only subset unchanged | Focused graph/core/CLI contracts and a public launcher scenario appropriate to the extracted scope |
| 5 | Trace / JSON-LD CLI / source task sharing | Trace `70db052` depends on activation. JSON-LD `2775413` + `d7efe0d` needs activation/store helper and acceptance, independently of trace. YouTube sharing `15cd2b8` waits for the task-write boundary | Graph/core/CLI/acceptance or source tests per slice; lint/build/docs |
| 6 | Readiness and pilot evidence; `a0a8363`, `0b62106`, `20c1971` | Consolidate after finished behaviour; use only the final safe template. Historical ledger closure does not complete the present pilot | Truthful evidence, protected private outputs and public-artifact checks |

The guard checks tracked path names and cannot certify content privacy. The existing strategy
already settles PEPYS authority; do not ask the owner to settle it again. Mixed core `b628643` and
reader `39733e0` remain later thematic extraction work after these foundations are understood.

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
| Merge approval | After a concrete PR passes checks and reviews, including actual reporting bots; skipped reviews ignored | Review a concise behaviour/evidence/risk brief; approve individually or an explicitly named dependency sequence | No; engineering preparation can proceed |
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
