---
document_id: AIDHA-TASK-010
owner: Product
status: Draft
version: "0.8"
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
> **Version:** 0.8
> **Last Updated:** 2026-05-31
> **Type:** TASK

# Task: Viable Prototype Agent Workplan

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-30 | AI     | Initial agent-executable task plan for the viable prototype sprints. | - | Draft | AIDHA-PLAN-008 |
| 0.2     | 2026-05-31 | AI     | Codebase-verified revision: anchor WP1 on the existing `Locator` union and FTS contract; reconcile WP3 routing metadata with the existing `TagAssignment` schema; remove the WP2→WP3 forward dependency (blockers via `taskDependsOn`); concretise the offline demo harness (named vectors, mock LLM, reuse existing acceptance scaffolding); commit demo artifact paths; note inbox-project default. | - | Draft | AIDHA-PLAN-008 |
| 0.3     | 2026-05-31 | AI     | Apply proposed responses to peer-debate questions: generic CLI supersession, `TagAssignment` routing metadata, early strategy ratification, separate trace work package, and a pilot viability bar. | - | Draft | AIDHA-PLAN-008 |
| 0.4     | 2026-05-31 | AI     | Final review pass: split routing metadata by grain (T010-03-01) and distinguish routing review status from editorial `state`; disambiguate the two review axes in `review next` (T010-01-04); fix stale WP3→WP4 anchor; consolidate `RationaleTrace` metadata field list and add schema-version policy note (T010-04-01); add claim-state vs routing-status note to verified anchors. | - | Draft | AIDHA-PLAN-008 |
| 0.5     | 2026-05-31 | AI     | Tighten the routing-metadata default: add `taxonomyVersion` to `TagAssignment`, but represent claim-grain routing review as distinct `routingReviewStatus`/`routingReviewReason` Claim metadata validated in `domain-metadata.ts`; remove residual wording that implied a tag-assignment `reviewStatus`. | - | Draft | AIDHA-PLAN-008 |
| 0.6     | 2026-05-31 | AI     | Reconcile with the implemented activation tranche: record generic query/task/review/re-entry helpers, the deterministic acceptance packet, the ratified strategy revision, and the remaining ingest-backed demo and trace-model work; make trace review statuses, IDs, edge usage, and command semantics decision-complete. | - | Draft | AIDHA-PLAN-008 |
| 0.7     | 2026-05-31 | AI     | Record the ingest-backed acceptance update: the viable prototype packet now runs generic PDF and LinkedIn ingests with `--mock-llm` before query, review, task, and re-entry. | - | Draft | AIDHA-PLAN-008 |
| 0.8     | 2026-05-31 | AI     | Record implementation of the minimal `RationaleTrace` graph model, trace list/show/reject commands, and provisional trace re-entry dossier section. | - | Draft | AIDHA-PLAN-008 |

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

## Current Implementation Status (2026-05-31)

The first activation tranche has landed in the working tree and should be treated as the baseline for
subsequent agents:

- AIDHA-STRATEGY-002 now ratifies the prototype positions that drive this plan.
- `@aidha/praecis-core` has shared activation helpers for cross-source claim query, task creation,
  task context, review queue construction, project re-entry dossiers, and locator display.
- `@aidha/praecis-cli` exposes the generic activation commands `aidha query`, `aidha task create`,
  `aidha task show`, `aidha review next`, and `aidha project reentry`.
- Routing metadata follows the grain decision: `taxonomyVersion` is on `TagAssignment`; Claim
  metadata carries `routingReviewStatus`, `routingReviewReason`, and `reviewPriority`.
- `scripts/acceptance/viable-prototype-activation.mjs` writes a deterministic no-network packet
  under `docs/55-testing/acceptance-run-<date>/` after running generic PDF and LinkedIn ingests with
  `--mock-llm`.
- WP4 now has a minimal `RationaleTrace` node model, core helpers, trace list/show/reject commands,
  and a provisional trace section in project re-entry dossiers.

Remaining gaps before this plan is closed:

- The YouTube activation surface has not yet been fully retired as wrappers over the shared generic
  helpers.
- Trace promotion remains intentionally deferred until approved-edge semantics are specified.
- WP6 still needs a real two-project pilot before any viable-prototype baseline tag.

**Verified codebase anchors (confirmed 2026-05-31, re-verify before relying on them):**

- Provenance addressing already uses the `Locator` discriminated union in
  `packages/praecis/core/src/types/locator.ts` (`timecode | page | dom | message | text | external`).
  Build generic display on it; do not reinvent it.
- Graph predicates already exist: `claimDerivedFrom`, `resourceHasExcerpt`, `taskMotivatedBy`,
  `taskPartOfProject`, plus `taskDependsOn`, `projectServesGoal`, `projectInArea`, `alsoSeenVia`,
  `corroboratedBy` (`packages/reconditum/src/schema/edge.ts`). No `RationaleTrace`/`SuggestedLink`/
  `Gap` NodeTypes exist yet — those are net-new in WP4.
- Claim editorial state (`draft | accepted | rejected`) already exists durably in
  `packages/reconditum/src/schema/domain-metadata.ts` (`state`) and is read by the YouTube review
  queue. This is distinct from the claim-grain routing review metadata proposed in WP3
  (`routingReviewStatus`, `routingReviewReason`) — see the routing-metadata decision in
  AIDHA-PLAN-008 for the grain distinction.
- `TagAssignment` (`packages/phyla/src/schema/assignment.ts`) already carries `confidence`, `source`,
  `assignedBy`, `assignedAt`, `notes`. WP3 adds a delta, not a greenfield schema.
- The generic `@aidha/praecis-cli` today implements only `ingest` and `config explain`. All other
  activation commands (`query`, `task`, `review`, `project`, `export dossier`) currently live in the
  YouTube CLI (`packages/praecis/youtube/src/cli.ts`).
- The only existing offline acceptance harness is YouTube-only
  (`scripts/acceptance/llm-offline-acceptance.mjs`, `scripts/acceptance/mock-openai-server.mjs`).
- Open architectural decisions are resolved as proposed defaults in the "Proposed Decisions For
  Review" section of AIDHA-PLAN-008; follow those defaults unless a maintainer changes the plan or a
  linked ADR.

## Work Package 0: Baseline And Demo Harness

### T010-00-01: Capture The Current Capability Baseline

**Status:** Implemented

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

**Status:** Implemented

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

## Work Package 0A: Strategy Ratification

### T010-0A-01: Promote Resolved Vision Positions

**Status:** Open

**Goal:** Make the strategy thesis governed before generic activation implementation depends on it.

**Steps:**

1. Promote the owner-response positions from the WIP strategy draft into AIDHA-STRATEGY-002 or a new
   governed strategy successor.
2. Preserve the original open-question history, but mark the resolved responses as strategic
   positions rather than live blockers.
3. Ratify the prototype claims that drive this workplan:
   - activation loop over further ingestion breadth;
   - project re-entry as the central viability test;
   - provisional routing with selective human review;
   - agentic traces as inspectable, non-authoritative graph data;
   - consequence/reversibility as the AI autonomy boundary.
4. Update cross-references in AIDHA-PLAN-008 and this task if the strategy document ID or title
   changes.
5. Run scoped DocOps checks and `pnpm docs:build`.

**Acceptance criteria:**

- [ ] Governed strategy no longer has unresolved placeholders for the answered questions.
- [ ] AIDHA-PLAN-008 references governed strategy, not only the WIP owner-response draft.
- [ ] Sprint 1 implementation branches can cite a ratified strategy thesis.

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

**Goal:** Surface material needing attention across source types, along two distinct axes:
editorial-state Claims (`draft`, per `domain-metadata.ts` `state`) and Claims whose routing is
unreviewed (the WP3 `routingReviewStatus`). These are independent — a Claim can be editorially
`accepted` with routing still unreviewed, or `draft` with routing confirmed.

**Steps:**

1. Add failing tests for (a) draft-editorial-state claims and (b) claims with unreviewed routing,
   asserting the two axes are reported distinctly (a claim may appear for one, the other, or both).
2. Implement `aidha review next [--project <id>] [--source <id>] [--limit <n>] [--json]`.
3. Sort by review priority when available, then by editorial state, updated time, and stable ID.
4. Include enough context to decide whether to accept, edit, reject, or route in a future command.
   Label which axis surfaced each item.
5. Do not implement a large TUI in this work package.

**Acceptance criteria:**

- [ ] Review output works across source types.
- [ ] Editorial state and routing-review status are reported as distinct axes, not one merged flag.
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
     graph state — **do not** depend on the agentic-trace/gap model from T010-04-01; that ordering
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
   Leave a clearly-labelled, optional slot for agentic *gaps* that T010-04-01 populates later, but the
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
4. Render Markdown suitable for saving to a caller-provided path when `--markdown` or `--out` is
   provided; the demo harness remains responsible for placing evidence under the
   `docs/55-testing/acceptance-run-<date>/` convention.
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

## Work Package 3: Routing And Review Priority

### T010-03-01: Add Routing Metadata Contract

**Status:** Open

**Goal:** Make provisional classification inspectable.

**Steps:**

1. Start from the **existing `TagAssignment` schema** (`packages/phyla/src/schema/assignment.ts`),
   which already provides `confidence`, `source` (`manual | automatic | imported | inferred`),
   `assignedBy`, `assignedAt`, and `notes`. Do **not** add a `method` field that duplicates `source`.
2. Place the new fields **by grain** (AIDHA-PLAN-008 routing-metadata decision):
   - `taxonomyVersion` is per-(claim,tag) → add as an optional field on `TagAssignment`; add
     `@aidha/phyla` schema tests.
   - **Routing review status/reason** is claim-grain by default. Add separate optional Claim metadata
     fields `routingReviewStatus` and `routingReviewReason` in
     `packages/reconditum/src/schema/domain-metadata.ts`. Keep them **distinct from the Claim's
     editorial `state`** (`draft | accepted | rejected`) already in that file; do not overload one
     field for editorial lifecycle and routing confirmation. If a maintainer instead chooses
     per-assignment routing review, require a linked ADR because `aidha review next` must then define
     how many assignment-level decisions aggregate into one claim-level queue item.
   - A graph schema bump is only required if this work introduces new NodeTypes or Predicates
     (it should not).
3. Update `KeywordTaxonomyClassifier` or introduce a small routing classifier that writes the new
   metadata.
4. Ensure old assignments and claims without the new fields remain valid (additive, optional fields).

**Acceptance criteria:**

- [ ] Routing metadata is typed and validated.
- [ ] Routing review status is distinguishable from a Claim's editorial `state` (no overloaded field).
- [ ] Provisional and human-reviewed routing can be distinguished at the grain `review next` consumes.
- [ ] Classifier tests cover confidence, source, and taxonomy version; routing/review tests cover
  `routingReviewStatus` and `routingReviewReason` on Claim metadata.

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

## Work Package 4: Agentic Trace Model

### T010-04-01: Add Minimal Agentic Trace Graph Support

**Status:** Open

**Goal:** Store suggested links and gaps without confusing them with human-approved graph structure.

**Steps:**

1. Add graph contract tests for the minimal trace model.
2. Prefer the smallest useful schema change: one `RationaleTrace` NodeType with typed metadata. Use a
   single canonical metadata field list (do not maintain two overlapping lists):
   - `traceKind`: `suggested_link | gap | sufficiency_prompt`;
   - `affectedNodeIds` as stable graph node IDs; validate that every referenced node exists before a
     trace is written;
   - optional `proposedPredicate` (when present, must validate against the existing `Predicate`
     enum in `packages/reconditum/src/schema/edge.ts`);
   - `rationale`;
   - `confidence`;
   - `agentModel`;
   - `promptVersion`;
   - `inputContext`;
   - `traceReviewStatus`: `open | rejected | promoted`.
   Generate deterministic trace IDs from `traceKind`, sorted `affectedNodeIds`, `proposedPredicate`
   when present, and a stable hash of the rationale/input context. Use existing `relatedTo` edges
   from the trace node to each affected node so traversal is cheap, but keep the authoritative target
   list in metadata for export and validation. Do not add `SuggestedLink`, `Gap`, `supports`,
   `blocks`, `requires`, or `suggestedByAgent` as first-pass graph schema concepts unless a failing
   test demonstrates that the single-node model is insufficient. (`review_priority` is intentionally
   not a `traceKind`: review priority is computed and stored in WP3; a trace records an agent's
   *suggestion*, not the authoritative priority.)
3. Confirm the graph schema-version policy for adding a NodeType. Precedent: the `alsoSeenVia` /
   `corroboratedBy` predicates were added in PLAN-007 without bumping
   `CURRENT_GRAPH_SCHEMA_VERSION` (still `1`), so additive enum extensions have been treated as
   non-breaking. Follow that precedent unless a persisted consumer must distinguish stores with vs.
   without `RationaleTrace`; if so, bump the version and note the migration in the PR.
4. Add helper functions to create and list traces. Minimum helper surface:
   - `createRationaleTrace(store, input)`;
   - `getRationaleTrace(store, traceId)`;
   - `listRationaleTraces(store, filters)`;
   - `rejectRationaleTrace(store, traceId, reason)`.
5. Do not auto-promote traces into durable human-approved edges.

**Acceptance criteria:**

- [ ] Agentic traces are inspectable as graph data.
- [ ] Trace metadata distinguishes machine-suggested from human-approved structure.
- [ ] Contract tests protect any new NodeType or Predicate.
- [ ] Re-entry dossiers can include provisional traces under a clearly labelled section.

### T010-04-02: Add Trace Review Commands

**Status:** Open

**Goal:** Make provisional traces manageable without a UI.

**Steps:**

1. Add CLI tests for:
   - `aidha trace list [--project <id>] [--json]`;
   - `aidha trace show <traceId> [--json]`;
   - `aidha trace reject <traceId> [--reason <text>] [--json]`.
2. Implement list/show/reject first.
3. Do not implement `trace promote` in this work package. Promotion requires explicit approved-edge
   semantics per `traceKind` and should be a follow-up with tests that create the durable target edge
   while preserving the original trace.
4. `trace list` defaults to `traceReviewStatus=open`, supports `--all`, and sorts by confidence
   descending then stable ID.
5. `trace reject` updates `traceReviewStatus=rejected` and records an optional rejection reason; it
   must not delete the trace node, affected nodes, source claims, tasks, or Resources.

**Acceptance criteria:**

- [ ] Users can inspect and reject provisional traces.
- [ ] Rejected traces remain auditable.
- [ ] Promotion remains deferred unless a separate implementation task defines explicit durable-edge
  semantics.
- [ ] Rejection does not delete source claims, tasks, or Resources.

## Work Package 5: Viability Quality Gates

### T010-05-01: Add Offline Activation Acceptance Test

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

### T010-05-02: Add Demonstration Packet Checks

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

### T010-05-03: Reconcile Product And User Docs

**Status:** Open

**Goal:** Align user-facing docs with the ratified strategy and implemented product surface.

**Steps:**

1. Confirm T010-0A-01 has promoted or superseded the WIP owner-response strategy positions.
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

- [ ] Governed product docs link to the ratified strategy.
- [ ] Quickstart docs demonstrate the activation loop.
- [ ] WIP strategy content is either promoted or clearly superseded.

## Work Package 6: Pilot And Release Baseline

### T010-06-01: Run A Personal-Use Pilot

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
6. Apply the pilot viability bar from AIDHA-PLAN-008:
   - at least one project yields a plausible next action without manually reopening original sources
     first;
   - at least one Task traces to Claim -> Excerpt -> Resource;
   - at least one prior source, claim, or task is surfaced that would otherwise have required
     re-derivation;
   - noisy or unhelpful outputs are recorded, not hidden.

**Acceptance criteria:**

- [ ] At least one project re-entry attempt is documented.
- [ ] At least one Task links to a Claim and source provenance.
- [ ] The pilot produces a go/no-go recommendation against the pre-registered viability bar.

### T010-06-02: Cut A Viable Prototype Baseline

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
