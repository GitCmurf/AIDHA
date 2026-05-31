---
document_id: AIDHA-TASK-010
owner: Product
status: Draft
version: "0.2"
last_updated: 2026-05-31
title: Viable Prototype Agent Workplan
type: TASK
docops_version: "2.0"
area: CORE
keywords: [prototype, mvp, agent-ready, activation, re-entry]
related_ids: [AIDHA-PLAN-008, AIDHA-STRATEGY-002, AIDHA-PLAN-007]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TASK-010
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-05-31
> **Type:** TASK

# Task: Viable Prototype Agent Workplan

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-30 | AI     | Initial agent-executable task plan for the viable prototype sprints. | - | Draft | AIDHA-PLAN-008 |
| 0.2     | 2026-05-31 | AI     | Codebase-verified revision: anchor WP1 on the existing `Locator` union and FTS contract; reconcile WP3 routing metadata with the existing `TagAssignment` schema; remove the WP2→WP3 forward dependency (blockers via `taskDependsOn`); concretise the offline demo harness (named vectors, mock LLM, reuse existing acceptance scaffolding); commit demo artifact paths; note inbox-project default. | - | Draft | AIDHA-PLAN-008 |

## Purpose

This task turns AIDHA-PLAN-008 into coding-agent-ready work packages. It is designed for small PRs
that can be delivered to demonstration-class quality: tests first, code, docs, validation evidence,
and review.

The implementation target is a generic activation loop:

```text
capture source -> extract claims -> route/review -> query project context -> create task
  -> trace task to claim/excerpt/resource -> export re-entry dossier
```

## Execution Rules

- Start every code task with a failing test or failing DocOps check.
- Keep each PR independently reviewable and reversible.
- Prefer shared `@aidha/praecis-core` helpers over copying YouTube-specific logic.
- Use the generic `@aidha/praecis-cli` as the primary user-facing surface.
- Preserve no-network CI. Network/live model checks must be optional.
- Do not pursue compatibility shims unless they reduce implementation risk; this repo is pre-alpha.
- Update docs and validation evidence in the same PR as behavior changes.
- Record exact commands run in the PR and in this task when a work package is closed.

**Verified codebase anchors (confirmed 2026-05-31, re-verify before relying on them):**

- Provenance addressing already uses the `Locator` discriminated union in
  `packages/praecis/core/src/types/locator.ts` (`timecode | page | dom | message | text | external`).
  Build generic display on it; do not reinvent it.
- Graph predicates already exist: `claimDerivedFrom`, `resourceHasExcerpt`, `taskMotivatedBy`,
  `taskPartOfProject`, plus `taskDependsOn`, `projectServesGoal`, `projectInArea`, `alsoSeenVia`,
  `corroboratedBy` (`packages/reconditum/src/schema/edge.ts`). No `RationaleTrace`/`SuggestedLink`/
  `Gap` NodeTypes exist yet — those are net-new in WP3.
- `TagAssignment` (`packages/phyla/src/schema/assignment.ts`) already carries `confidence`, `source`,
  `assignedBy`, `assignedAt`, `notes`. WP3 adds a delta, not a greenfield schema.
- The generic `@aidha/praecis-cli` today implements only `ingest` and `config explain`. All other
  activation commands (`query`, `task`, `review`, `project`, `export dossier`) currently live in the
  YouTube CLI (`packages/praecis/youtube/src/cli.ts`).
- The only existing offline acceptance harness is YouTube-only
  (`scripts/acceptance/llm-offline-acceptance.mjs`, `scripts/acceptance/mock-openai-server.mjs`).
- Open architectural decisions are catalogued in the "Judgement Calls For Peer Debate" section of
  AIDHA-PLAN-008; resolve the relevant one before starting the work package it affects.

## Work Package 0: Baseline And Demo Harness

### T010-00-01: Capture The Current Capability Baseline

**Status:** Open

**Goal:** Establish the factual baseline before changing behavior.

**Steps:**

1. Run the current package tests most relevant to the activation path:
   - `pnpm --dir packages/praecis/core test`
   - `pnpm --dir packages/praecis/cli test`
   - `pnpm --dir packages/praecis/youtube test`
   - `pnpm --dir packages/reconditum test`
   - `pnpm --dir packages/phyla test`
2. Run `pnpm docs:build`.
3. Record which commands are currently generic and which remain YouTube-specific:
   - ingest;
   - query;
   - review;
   - task create/show;
   - dossier/export;
   - project/area/goal context.
4. Add a short baseline note under `docs/55-testing/` after the harness in T010-00-02 exists, or
   add it as a section in this task if no new testing doc is warranted.

**Acceptance criteria:**

- [ ] Current activation gaps are listed with package/file references.
- [ ] Test and docs-build results are recorded.
- [ ] No implementation work starts from stale assumptions.

### T010-00-02: Build A Deterministic Viable-Prototype Demo Script

**Status:** Open

**Goal:** Produce one command that proves the current or next activation loop on a clean local store.

**Steps:**

1. Add a script under `scripts/acceptance/` (align with the existing acceptance harness; do not start
   a parallel `scripts/demo/` tree) that:
   - creates a fresh temporary SQLite store;
   - runs at least two no-network ingests through `@aidha/praecis-cli`, using two
     offline-deterministic vectors (e.g. a local-file `pdf` and a local-file `web`/`text`); avoid any
     vector whose acquire step needs network or live credentials;
   - injects a mock model client for claim extraction (reuse the pattern in
     `scripts/acceptance/llm-offline-acceptance.mjs` / `scripts/acceptance/mock-openai-server.mjs` —
     "no-network" ingest still requires an LLM for claim extraction, so a mock is mandatory, not
     optional);
   - captures JSON output;
   - exports or prints Resource, Excerpt, Claim, and provenance identifiers;
   - writes outputs to a stable demo directory under `docs/55-testing/` (follow the existing
     `docs/55-testing/acceptance-run-<date>/` convention).
2. Use deterministic fixture data, clocks, and IDs where practical. Establish the injectable-clock or
   timestamp-redaction mechanism here, since `GraphNode.createdAt`/`updatedAt` carry real timestamps
   and every downstream golden fixture (WP2) depends on this being solved once.
3. Fail the script if expected claims, excerpt links, or source metadata are missing.
4. Add a focused test for the script entrypoint or its reusable helpers.
5. Document the command and expected artifacts in `docs/55-testing/`.

**Acceptance criteria:**

- [ ] One local command creates a fresh demonstration packet.
- [ ] The command does not require network access.
- [ ] The packet includes JSON summaries and human-readable notes.
- [ ] Rerunning the command shows stable IDs and stable ordering for unchanged fixtures.

## Work Package 1: Generic Activation CLI

### T010-01-01: Define Shared Activation Query Types

**Status:** Open

**Goal:** Create a typed boundary for graph reads used by query, task, and re-entry commands.

**Steps:**

1. Add a failing test in `packages/praecis/core/tests/` or `packages/praecis/cli/tests/` that builds
   a small graph with:
   - Resource;
   - Excerpt;
   - Claim;
   - Project;
   - Task;
   - `resourceHasExcerpt`;
   - `claimDerivedFrom`;
   - `taskMotivatedBy`;
   - `taskPartOfProject`.
2. Define a small `ActivationContext` or equivalent output model containing:
   - claim ID/text/state;
   - source/resource summary;
   - excerpt locator typed as the existing `Locator` union (not bare timestamp fields);
   - task links;
   - project links;
   - classification/review metadata.
3. Implement read helpers against the GraphStore contract, not a SQLite-only path.
4. Add SQLite parity coverage where the helper depends on traversal or FTS behavior.
5. Add a `Locator`-to-display projection helper so each locator kind renders a correct human label
   and (where applicable) deep link. This is the seam that lets the same helper serve YouTube
   (`timecode`), PDF (`page`), and web (`dom`) provenance. The YouTube CLI's existing
   timestamp-coupled `ClaimSearchHit`/`TaskClaimContext` must be migrated onto this projection in
   T010-01-02/03 rather than left as a second implementation.

**Acceptance criteria:**

- [ ] Activation query helpers return deterministic, sorted results.
- [ ] Helpers follow provenance links from Claim to Excerpt to Resource.
- [ ] Helpers work against in-memory and SQLite stores where relevant.
- [ ] No source package imports are introduced into `praecis/core`.
- [ ] Provenance is carried as the `Locator` union; no command-layer code reads bare `timestampUrl`/
  `timestampSeconds` fields outside the YouTube `timecode` projection.

### T010-01-02: Add Generic `aidha query`

**Status:** Open

**Goal:** Query claims across all ingested source types from the generic CLI.

**Steps:**

1. Write failing CLI tests in `packages/praecis/cli/tests/cli.test.ts` for:
   - text output;
   - `--json` output;
   - source filter;
   - project filter;
   - no-result behavior.
2. Implement `aidha query <text>` in `packages/praecis/cli/src/index.ts`.
3. Use the shared activation query helpers from T010-01-01. Ranking is deterministic lexical/FTS via
   the `GraphStore` `supportsFts()`/`searchText()` contract (mirror
   `packages/praecis/youtube/src/retrieve/query.ts`); fall back to a deterministic lexical scan when
   FTS is unavailable. No embeddings/semantic search (would break no-network + determinism).
4. Include provenance fields in JSON output:
   - claim ID;
   - resource ID;
   - excerpt ID;
   - locator;
   - source type;
   - review state.
5. Keep human-readable output short enough for repeated use.

**Acceptance criteria:**

- [ ] Query works for claims created by more than one source vector.
- [ ] `--json` output is stable and agent-readable.
- [ ] Text output includes enough provenance to inspect the source.
- [ ] Existing ingest/config commands continue to pass their tests.

### T010-01-03: Add Generic `aidha task create` And `aidha task show`

**Status:** Open

**Goal:** Create and inspect Tasks from Claims through the generic CLI.

**Steps:**

1. Add failing tests for:
   - creating a Task from an existing Claim;
   - rejecting a missing Claim ID;
   - linking Task to Project when `--project` is provided;
   - showing the Task with supporting Claim, Excerpt, and Resource context.
2. Implement:
   - `aidha task create --from-claim <claimId> --title <title> [--project <id>] [--json]`;
   - `aidha task show <taskId> [--json]`.
3. Use existing graph predicates:
   - `taskMotivatedBy` for Task -> Claim;
   - `taskPartOfProject` for Task -> Project.
4. Add deterministic task ID generation. Reuse the existing inbox convention
   (`DEFAULT_INBOX_PROJECT_ID = 'project-inbox'` in `packages/praecis/youtube/src/tasks/index.ts`)
   as the default project when `--project` is omitted, so generic and YouTube task creation converge
   on one model.
5. Migrate the proven YouTube task logic (`packages/praecis/youtube/src/tasks/index.ts`) into a
   shared `praecis-core`/`praecis-cli` helper and have the YouTube CLI consume it; do not leave a
   duplicate task path. Two task-creation implementations is a failure of this task.

**Acceptance criteria:**

- [ ] Task creation is source-agnostic.
- [ ] `task show` traces the Task back to Claim, Excerpt, and Resource.
- [ ] JSON and text output are both tested.
- [ ] Existing YouTube task tests are either preserved or superseded with generic tests.

### T010-01-04: Add Generic `aidha review next`

**Status:** Open

**Goal:** Surface draft/provisional material across source types.

**Steps:**

1. Add failing tests for draft claims and provisional classifications.
2. Implement `aidha review next [--project <id>] [--source <id>] [--limit <n>] [--json]`.
3. Sort by review priority when available, then by state, updated time, and stable ID.
4. Include enough context to decide whether to accept, edit, reject, or route in a future command.
5. Do not implement a large TUI in this work package.

**Acceptance criteria:**

- [ ] Review output works across source types.
- [ ] Draft and provisional items are visibly distinct.
- [ ] Output includes provenance and classification metadata.

## Work Package 2: Project Re-entry Dossier

### T010-02-01: Define `ProjectReentryDossier`

**Status:** Open

**Goal:** Define the data model before rendering.

**Steps:**

1. Add a failing fixture test with a graph containing:
   - one Project;
   - at least two Claims;
   - at least two Resources from different source types;
   - one Task motivated by a Claim;
   - one blocker represented as a Task with an unmet `taskDependsOn` edge (derivable from current
     graph state — **do not** depend on the agentic-trace/gap model from T010-03-03; that ordering
     was a forward dependency and is removed here).
2. Define `ProjectReentryDossier` with:
   - project summary;
   - relevant claims;
   - supporting sources;
   - open tasks;
   - review items;
   - blockers (unmet `taskDependsOn`);
   - suggested next actions;
   - provenance index.
   Leave a clearly-labelled, optional slot for agentic *gaps* that T010-03-03 populates later, but the
   dossier must be useful with that slot empty.
3. Keep the model independent of Markdown rendering.
4. Add deterministic sorting rules to the model builder.

**Acceptance criteria:**

- [ ] The model can be generated from a fixture graph.
- [ ] Every listed claim has source provenance.
- [ ] Every listed task shows its motivating Claim when present.
- [ ] The model is stable across reruns.

### T010-02-02: Add `aidha project reentry`

**Status:** Open

**Goal:** Provide the first user-facing "where was I?" command.

**Steps:**

1. Add CLI tests for:
   - `aidha project reentry --project <id>`;
   - `--json`;
   - `--markdown`;
   - missing project;
   - empty project.
2. Implement the command in `@aidha/praecis-cli`.
3. Render concise text by default.
4. Render Markdown suitable for saving in `out/` when `--markdown` or `--out` is provided.
5. Include source provenance and next-action section.

**Acceptance criteria:**

- [ ] The command answers what the user already knows about a project.
- [ ] The command lists open tasks and their evidence.
- [ ] Markdown and JSON output are deterministic.
- [ ] The demo harness can call this command.

### T010-02-03: Add Re-entry Dossier Export Evidence

**Status:** Open

**Goal:** Make the new behavior demonstrable and reviewable.

**Steps:**

1. Add a golden Markdown fixture for one re-entry dossier.
2. Add a JSON fixture or snapshot that excludes non-deterministic timestamps.
3. Update `docs/60-devex/ingest-quickstart.md` or a new runbook section to show:
   - ingest;
   - query;
   - task create;
   - project reentry.
4. Add evidence to the viable-prototype testing note.

**Acceptance criteria:**

- [ ] Golden output changes are intentional and reviewed.
- [ ] Quickstart docs show the activation loop, not only ingestion.
- [ ] `pnpm docs:build` passes.

## Work Package 3: Routing, Review Priority, And Agentic Traces

### T010-03-01: Add Routing Metadata Contract

**Status:** Open

**Goal:** Make provisional classification inspectable.

**Steps:**

1. Start from the **existing `TagAssignment` schema** (`packages/phyla/src/schema/assignment.ts`),
   which already provides `confidence`, `source` (`manual | automatic | imported | inferred`),
   `assignedBy`, `assignedAt`, and `notes`. Add schema tests only for the genuinely new fields:
   - taxonomy version;
   - review status;
   - review reason.
   Do **not** add a `method` field that duplicates `source`. If routing method must be distinguished
   from `source`, define that distinction explicitly and justify it in the PR; otherwise reuse
   `source`.
2. Decide where the new fields live: extending the durable `@aidha/phyla` `TagAssignment` contract
   (forces a graph-schema-version bump and contract tests for all consumers) vs. storing routing/
   review state in `Claim`/`Resource` node metadata (lower ceremony, weaker typing). This is a
   flagged judgement call in AIDHA-PLAN-008 — resolve it before implementing. Prefer a typed
   structured field over opaque strings in `notes`.
3. Update `KeywordTaxonomyClassifier` or introduce a small routing classifier that writes the new
   metadata.
4. Ensure old assignments without the new fields remain valid (additive, optional fields).

**Acceptance criteria:**

- [ ] Routing metadata is typed and validated.
- [ ] Provisional and human-reviewed assignments can be distinguished.
- [ ] Classifier tests cover confidence and method.

### T010-03-02: Compute Review Priority

**Status:** Open

**Goal:** Reserve user attention for high-leverage review.

**Steps:**

1. Add tests for review-priority rules:
   - low classification confidence;
   - active project relevance;
   - action-implying claim;
   - missing routing explanation;
   - conflict marker.
2. Implement a pure priority function returning:
   - priority score;
   - reason codes;
   - short human-readable reason.
3. Store priority metadata where review commands can read it.
4. Wire `aidha review next` to sort by this priority.

**Acceptance criteria:**

- [ ] Low-confidence or action-implying items sort above low-value backlog.
- [ ] Reason codes are visible in JSON output.
- [ ] Priority computation is deterministic and testable offline.

### T010-03-03: Add Minimal Agentic Trace Graph Support

**Status:** Open

**Goal:** Store suggested links and gaps without confusing them with human-approved graph structure.

**Steps:**

1. Add graph contract tests for the minimal trace model.
2. Prefer the smallest useful schema change:
   - NodeTypes such as `RationaleTrace`, `SuggestedLink`, and `Gap`, or one `RationaleTrace` node
     type with typed metadata;
   - predicates such as `suggestedByAgent`, `supports`, `blocks`, `requires`, or existing
     predicates with explicit provisional metadata if a narrower change is sufficient.
3. Record for each trace:
   - agent/model;
   - prompt version;
   - input context;
   - confidence;
   - affected nodes/edges;
   - review status.
4. Add helper functions to create and list traces.
5. Do not auto-promote traces into durable human-approved edges.

**Acceptance criteria:**

- [ ] Agentic traces are inspectable as graph data.
- [ ] Trace metadata distinguishes machine-suggested from human-approved structure.
- [ ] Contract tests protect any new NodeType or Predicate.
- [ ] Re-entry dossiers can include provisional traces under a clearly labelled section.

### T010-03-04: Add Trace Review Commands

**Status:** Open

**Goal:** Make provisional traces manageable without a UI.

**Steps:**

1. Add CLI tests for:
   - `aidha trace list [--project <id>] [--json]`;
   - `aidha trace show <traceId> [--json]`;
   - `aidha trace reject <traceId>`;
   - optional `aidha trace promote <traceId>` if the promotion semantics are clear.
2. Implement list/show/reject first.
3. Only implement promotion when the target approved edge semantics are explicit and tested.

**Acceptance criteria:**

- [ ] Users can inspect and reject provisional traces.
- [ ] Promotion, if implemented, creates explicit durable graph edges and preserves the original
  trace.
- [ ] Rejection does not delete source claims, tasks, or Resources.

## Work Package 4: Viability Quality Gates

### T010-04-01: Add Offline Activation Acceptance Test

**Status:** Open

**Goal:** Protect the activation loop in CI.

**Steps:**

1. Add an offline test that runs:
   - ingest two source fixtures;
   - query;
   - task create;
   - project reentry;
   - export or render outputs.
2. Use a fresh SQLite store per test.
3. Assert:
   - no duplicate Resource on rerun;
   - every Claim has Excerpt provenance;
   - created Task has `taskMotivatedBy`;
   - re-entry dossier includes the Task and supporting Claim.
4. Keep the fixture small enough for routine CI.

**Acceptance criteria:**

- [ ] The activation path is covered by a single no-network integration test.
- [ ] The test fails on broken provenance.
- [ ] The test fails on unstable ordering where deterministic output is required.

### T010-04-02: Add Demonstration Packet Checks

**Status:** Open

**Goal:** Make manual demos less fragile.

**Steps:**

1. Extend the demo script from T010-00-02 to validate generated artifacts.
2. Check for:
   - command transcript;
   - JSON summaries;
   - Markdown re-entry dossier;
   - graph export or store summary;
   - deterministic rerun evidence.
3. Add a short README inside the generated packet or a governed testing note describing what the
   demo proves.

**Acceptance criteria:**

- [ ] The packet can be reviewed without reading test code.
- [ ] The packet proves capture -> route -> query -> task -> re-entry.
- [ ] The command exits non-zero when a required artifact is missing.

### T010-04-03: Reconcile Strategy And User Docs

**Status:** Open

**Goal:** Align governed docs with the refined strategy and implemented product surface.

**Steps:**

1. Promote the resolved owner-response positions for AIDHA-STRATEGY-002 into a governed strategy
   revision or a new governed strategy document.
2. Update the product docs to reflect the prototype thesis:
   - trusted capture;
   - provisional routing;
   - project re-entry;
   - claim-to-task conversion;
   - agentic traces.
3. Update `docs/60-devex/ingest-quickstart.md` and relevant runbooks to prefer generic `aidha`
   commands where they exist.
4. Update `mkdocs.yml` navigation for any new governed docs.
5. Run scoped DocOps checks and `pnpm docs:build`.

**Acceptance criteria:**

- [ ] The strategy no longer contains unanswered open-question placeholders for resolved issues.
- [ ] Quickstart docs demonstrate the activation loop.
- [ ] WIP strategy content is either promoted or clearly superseded.

## Work Package 5: Pilot And Release Baseline

### T010-05-01: Run A Personal-Use Pilot

**Status:** Open

**Goal:** Test whether the prototype reduces re-derivation in a real workflow.

**Steps:**

1. Select:
   - one dormant project;
   - one active project;
   - a small set of relevant sources.
2. Ingest the sources.
3. Run query and project re-entry before manually reviewing old notes.
4. Create at least one Task from a prior Claim.
5. Record:
   - time from command start to plausible next action;
   - whether existing Claims avoided re-research;
   - whether the dossier surfaced a useful source;
   - what was missing or noisy.

**Acceptance criteria:**

- [ ] At least one project re-entry attempt is documented.
- [ ] At least one Task links to a Claim and source provenance.
- [ ] The pilot produces a go/no-go recommendation for a prototype baseline tag.

### T010-05-02: Cut A Viable Prototype Baseline

**Status:** Open

**Goal:** Create an auditable milestone when the activation loop is demonstrably useful.

**Steps:**

1. Update changelog and release notes.
2. Record test commands and demo evidence.
3. Ensure docs and package tests pass.
4. Code-review material changes before commit.
5. Tag a baseline only after validation succeeds.

**Acceptance criteria:**

- [ ] Release notes state what is viable and what remains deferred.
- [ ] Demo packet path and validation commands are recorded.
- [ ] `pnpm docs:build` passes.
- [ ] Baseline tag is created only after code review and successful validation.

## Cross-Work-Package Validation

Before each PR is marked ready for review, run the smallest relevant focused tests plus the relevant
package builds. For broad activation changes, use:

```bash
pnpm --dir packages/reconditum test
pnpm --dir packages/phyla test
pnpm --dir packages/praecis/core test
pnpm --dir packages/praecis/cli test
pnpm --dir packages/praecis/youtube test
pnpm --dir packages/praecis/cli build
pnpm docs:build
node scripts/meminit-check.mjs docs/05-planning/plan-008-viable-prototype-sprint-plan.md docs/05-planning/tasks/task-010-viable-prototype-agent-workplan.md
```

If a package is untouched and the focused tests prove the behavior, record the narrower command and
the reason full package coverage was not necessary.

## Definition Of Done

This task is done when:

- [ ] A no-network demo proves multi-source capture and cross-source activation.
- [ ] Generic CLI supports query, task create/show, review next, and project re-entry.
- [ ] Project re-entry dossier is deterministic and includes provenance-backed tasks.
- [ ] Routing metadata distinguishes provisional machine placement from human-reviewed state.
- [ ] Agentic traces are inspectable and not silently promoted to approved graph structure.
- [ ] Strategy and user docs are reconciled with the implemented prototype.
- [ ] A pilot run provides evidence that the tool reduces re-derivation or identifies why it does
  not yet do so.
