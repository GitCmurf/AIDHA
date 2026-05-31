---
document_id: AIDHA-PLAN-008
owner: Product
status: Draft
version: "0.6"
last_updated: 2026-05-31
title: Viable Prototype Sprint Plan
type: PLAN
docops_version: "2.0"
area: CORE
keywords: [prototype, mvp, activation, re-entry, planning]
related_ids: [AIDHA-STRATEGY-002, AIDHA-STRAT-001, AIDHA-PLAN-002, AIDHA-PLAN-007, AIDHA-TASK-010]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PLAN-008
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.6
> **Last Updated:** 2026-05-31
> **Type:** PLAN

# Viable Prototype Sprint Plan

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-30 | AI     | Initial plan derived from strategy, planning, and codebase review. | - | Draft | AIDHA-TASK-010 |
| 0.2     | 2026-05-31 | AI     | Critical revision after codebase verification: name existing `Locator` union and migration semantics; reconcile routing metadata with the existing `TagAssignment` schema; resolve the Sprint 2→3 forward dependency (blockers-now vs gaps-later); specify deterministic query semantics; concretise the offline demo harness (named vectors + mock LLM); add a Judgement Calls section for peer debate. | - | Draft | AIDHA-TASK-010 |
| 0.3     | 2026-05-31 | AI     | Convert peer-debate questions into proposed decisions: generic CLI supersession, routing metadata in `TagAssignment`, early strategy ratification, separate agentic-trace sprint, and a pre-registered pilot viability bar. | - | Draft | AIDHA-TASK-010 |
| 0.4     | 2026-05-31 | AI     | Final review pass: split routing-metadata decision by grain (taxonomyVersion per-assignment vs claim-grain review status) after the one-Claim-many-TagAssignments cardinality argument; distinguish routing review status from the existing editorial `state`; fix stale Sprint 3→4 cross-references from the renumber; remove residual `method` from Gap 3; align Sprint 0 demo-packet path; consolidate the `RationaleTrace` metadata field list and add the schema-version policy note. | - | Draft | AIDHA-TASK-010 |
| 0.5     | 2026-05-31 | AI     | Tighten the routing-metadata split into an implementation default: `taxonomyVersion` remains per-assignment on `TagAssignment`, while claim-level routing review uses distinct `routingReviewStatus`/`routingReviewReason` Claim metadata validated in `domain-metadata.ts`; update Sprint 3 acceptance to remove residual taxonomy-contract ambiguity. | - | Draft | AIDHA-TASK-010 |
| 0.6     | 2026-05-31 | AI     | Reconcile the sprint plan with the implemented activation tranche: generic activation helpers and CLI commands, strategy ratification, routing metadata, deterministic acceptance evidence, and the remaining ingest-backed demo, YouTube wrapper retirement, trace model, and pilot gates. | - | Draft | AIDHA-TASK-010 |

## Purpose

This plan identifies the most valuable next sprints for AIDHA after review of the strategy docs,
the planning corpus, the owner-response draft for AIDHA-STRATEGY-002, and the current codebase.

The recommendation is direct: AIDHA has enough ingestion breadth for the next prototype. The highest
value work is now the **activation loop**: route captured knowledge into project context, help the
user re-enter work, create tasks with provenance, and demonstrate that "re-find beats re-think" in a
repeatable local workflow.

The paired agent-executable task plan is AIDHA-TASK-010.

## Inputs Reviewed

Primary strategy inputs:

- AIDHA-STRAT-001: minimum end-to-end vertical slice.
- AIDHA-STRATEGY-002: product vision, design principles, AI integration philosophy, and open
  questions.
- Owner-response draft for AIDHA-STRATEGY-002, especially the strategic positions and prototype
  strategy sections dated May 2026.

Primary planning inputs:

- AIDHA-PLAN-002: MVP delivery and documentation reconciliation.
- AIDHA-PLAN-004: claim quality and editorial ranking.
- AIDHA-PLAN-005: user configuration profiles.
- AIDHA-PLAN-006: verification and keyphrase refactor.
- AIDHA-PLAN-007: other ingestion vectors.
- AIDHA-TASK-007 and AIDHA-TASK-008: closed technical debt and sprint burn-down ledgers.
- AIDHA-TASK-009: speaker attribution pipeline.

Implementation evidence reviewed:

- `packages/reconditum`: graph schema, predicates, storage backends, JSON-LD export, contract tests.
- `packages/phyla`: taxonomy schema, registry, tag assignment model, validation tests.
- `packages/aidha-config`: profile-based config resolution, source registration, safe writes, schema
  validation, and tests.
- `packages/praecis/core`: shared ingestion spine, source composition, Locators, chunkers, two-pass
  claim extraction, dedup, classification, sensitivity gates, export helpers, and tests.
- `packages/praecis/cli`: generic multi-vector ingest and config explain commands.
- `packages/praecis/youtube`: mature YouTube-specific review, retrieval, task, dossier, eval, and
  diagnostics surfaces.
- `packages/praecis/sources/*`, `packages/praecis/decode/*`, and `packages/praecis/acquire/*`:
  implemented vector, decode, and acquisition packages for web, PDF, RSS, podcast, voice, meeting,
  Readwise, email, LinkedIn, transcription, diarisation, OCR, text extraction, and web fetch.

## Current Assessment

### Post-Tranche Note (2026-05-31)

The working tree now contains the first generic activation tranche. `@aidha/praecis-core` exposes
shared activation helpers, `@aidha/praecis-cli` exposes generic `query`, `task`, `review`, and
`project reentry` commands, routing metadata has been typed at the agreed grains, and the strategy
positions have been ratified in AIDHA-STRATEGY-002. A deterministic acceptance packet is generated
under `docs/55-testing/acceptance-run-<date>/`.

The plan remains open because the acceptance harness still seeds graph facts directly rather than
driving two generic ingest vectors with a mock model, YouTube activation wrappers still need
retirement or convergence, Sprint 4 `RationaleTrace` support is not implemented, and the Sprint 6
pilot has not been run.

### Strengths

- The original YouTube MVP is effectively complete and heavily tested.
- The multi-vector ingestion architecture from AIDHA-PLAN-007 is substantially implemented.
- The project now has reusable package boundaries: graph backend, taxonomy, config, shared Praecis
  core, generic CLI, and source-specific adapters.
- Provenance is materially stronger than the early MVP: Locators, source metadata, speaker metadata,
  dedup keys, and Resource/Excerpt/Claim links are present.
- The codebase has a broad test surface and a mature eval harness for YouTube extraction quality.
- Configuration and source registration are no longer ad hoc.

### Gaps That Block A Genuinely Viable MVP

1. **Activation is now partially generic, but not yet ingest-proven end to end.** The generic `aidha`
   CLI can ingest across vectors and now exposes query, review, task, and project re-entry commands,
   but the acceptance path still seeds graph facts directly and the YouTube activation wrappers need
   convergence or retirement.
2. **The operational graph is under-surfaced.** Node and predicate support exists for Project, Goal,
   Area, Task, and task provenance, but the user cannot yet rely on one cross-vector flow to answer:
   "What did I already know, what did I decide, and what should I do next?"
3. **Routing remains too shallow for the refined strategy.** Keyword taxonomy assignment exists
   (with `confidence`, `source`, `assignedBy`, `assignedAt`), but the prototype needs visible
   provisional placement, taxonomy version, a claim-level routing review status distinct from the
   claim's editorial state, and reasons for review priority. (Provenance reuses the existing
   `source` field rather than a new `method` field — see Proposed Decisions For Review.)
4. **Agentic traces are not yet first-class.** The strategy calls for inspectable suggested links,
   gaps, and rationale traces that are distinct from human-approved structure.
5. **Demonstrability is improving but still not at the final bar.** A deterministic activation
   packet now proves query -> review -> task -> re-entry on a clean local store; the remaining bar is
   capture -> route -> re-entry -> task -> export through two generic ingest vectors with a mock
   model.
6. **Planning and strategy drift are reduced, but docs must keep following implementation.**
   AIDHA-STRATEGY-002 now records the ratified prototype positions; quickstarts and runbooks still
   need to shift from the YouTube-only mental model to the generic activation surface where parity
   exists.

## Viable MVP Definition

AIDHA is viable enough for the next release baseline when a clean local checkout can demonstrate all
of the following without manual database surgery:

1. Capture at least two heterogeneous source types into the same local graph.
2. Persist Resources, Excerpts, Claims, source metadata, Locators, review state, and classification
   metadata with deterministic IDs and provenance.
3. Retrieve relevant prior claims across source types through the generic CLI.
4. Create a Task from a Claim and trace the Task back to the supporting Claim, Excerpt, and Resource.
5. Generate a project re-entry dossier that answers:
   - What is this project?
   - What do I already know?
   - What sources support this?
   - What tasks are open?
   - What appears blocked or missing?
   - What next action is justified?
6. Store provisional routing and agentic rationale traces distinctly from human-approved structure.
7. Produce a deterministic demo packet: command transcript, SQLite store, JSON summaries, Markdown
   dossier, JSON-LD export, and re-entry dossier.
8. Pass focused unit/integration tests, package builds, scoped DocOps checks, and `pnpm docs:build`.

## Sprint Sequence

### Sprint 0: Baseline Truth And Demonstration Harness

**Goal:** Establish a reproducible baseline and make current capability obvious.

**Why first:** The repo has more capability than the older planning docs imply. Before adding more
features, lock a small demonstration path that future work must keep green.

**Scope:**

- Define a fixture-backed viable-prototype scenario using at least two source types. Name the two
  offline-deterministic vectors explicitly (e.g. a local-file `pdf` and a local-file `web`/`text`
  ingest); avoid vectors whose acquisition step requires network or live API credentials.
- Note the claim-extraction dependency: "no-network" ingest still requires an LLM for claim
  extraction, so the harness must inject a mock model client (extend the pattern in
  `scripts/acceptance/llm-offline-acceptance.mjs` / `scripts/acceptance/mock-openai-server.mjs`
  rather than duplicating it). The current offline harness is YouTube-only; this sprint generalises
  it to the generic `@aidha/praecis-cli` path.
- Build a local acceptance command that creates a fresh store, runs ingestion, captures outputs, and
  writes a demo evidence directory.
- Record which user-facing flows are generic today (`ingest`, `config explain`) and which still
  depend on the YouTube-specific CLI (`query`, `related`, `review`, `task`, `area`, `goal`,
  `project`, `export dossier`). This gap inventory is the factual basis for Sprints 1–3.
- Add a short testing note under `docs/55-testing/` after the script exists.

**Acceptance:**

- A single command produces a fresh demonstration packet under
  `docs/55-testing/acceptance-run-<date>/` (the existing acceptance-run convention).
- The packet includes source summaries, claim IDs, provenance, and deterministic rerun evidence.
- The gap list is current and linked from AIDHA-TASK-010.

### Sprint 0A: Strategy Ratification

**Goal:** Promote the resolved owner-response positions for AIDHA-STRATEGY-002 into governed
strategy before broad activation implementation begins.

**Why in parallel with Sprint 0:** Sprints 1-4 depend on the refined thesis that AIDHA is a
provenance-preserving cognitive continuity system whose next proof point is activation, not more
capture. Building against an unpromoted WIP strategy invites avoidable rework.

**Scope:**

- Promote the owner responses from the WIP strategy draft into AIDHA-STRATEGY-002 or into a new
  governed strategy successor.
- Preserve the open-question history but mark the resolved positions as strategic decisions.
- Explicitly ratify:
  - CLI-first but generic activation-oriented interface;
  - machine-assisted inbox-zero with provisional routing;
  - consequence/reversibility boundary for AI autonomy;
  - agentic traces as provisional, inspectable structure;
  - project re-entry and research-to-action conversion as core prototype tests.

**Acceptance:**

- Governed strategy no longer contains unanswered placeholders for resolved questions.
- AIDHA-PLAN-008 and AIDHA-TASK-010 reference a ratified strategy document, not a WIP draft, before
  Sprint 1 implementation branches are treated as ready for review.

### Sprint 1: Generic Activation CLI

**Goal:** Move the user's core activation operations into `@aidha/praecis-cli`.

**Why now:** Multi-vector ingestion is not enough. A user needs one CLI surface for retrieval,
review, task creation, and context restoration regardless of source type.

**Scope:**

- Add generic graph query helpers in `@aidha/praecis-core` or `@aidha/praecis-cli`.
- Project all provenance display from the existing `Locator` discriminated union in
  `@aidha/praecis-core` (`packages/praecis/core/src/types/locator.ts`: `timecode | page | dom |
  message | text | external`). Do **not** introduce a new locator abstraction — the timestamp-coupled
  fields in the YouTube `ClaimSearchHit`/`TaskClaimContext` (`videoId`, `timestampSeconds`,
  `timestampUrl`) must be replaced by a `Locator`-aware display projection so non-timecode vectors
  (PDF page, web fragment, email message) render correctly.
- Add generic `aidha query` with JSON and readable text output. Ranking is **deterministic lexical /
  FTS** built on the existing `GraphStore` `supportsFts()` / `searchText()` contract (mirroring
  `packages/praecis/youtube/src/retrieve/query.ts`). Embedding/semantic search is explicitly out of
  scope (see Explicit Non-Priorities) to preserve the no-network and determinism guarantees.
- Add generic `aidha task create --from-claim` and `aidha task show`. Reuse the existing inbox
  convention (`DEFAULT_INBOX_PROJECT_ID = 'project-inbox'`) for the default project.
- Add generic `aidha review next` for draft/provisional claims.
- Keep output deterministic and machine-readable.

**Acceptance:**

- The generic CLI can query claims ingested from more than one vector, with locator-correct
  provenance for at least one non-timecode vector.
- A task can be created from any Claim node, not just YouTube claims.
- Task context follows `taskMotivatedBy`, `claimDerivedFrom`, and `resourceHasExcerpt` links.
- The YouTube CLI's query/task surface is refactored to consume the shared `praecis-core` helpers
  rather than retaining a parallel timestamp-coupled implementation. Two divergent query paths is a
  failure of this sprint, not an acceptable interim state.

### Sprint 2: Project Re-entry Dossier

**Goal:** Make AIDHA answer "where was I?" for a project.

**Why now:** This is the clearest test of the refined strategy. It directly measures cognitive
continuity and makes the product more than an ingestion engine.

**Scope:**

- Define a typed `ProjectReentryDossier` model.
- Add `aidha project reentry --project <id>` with `--json` and `--markdown` output.
- Include project metadata, related claims, supporting sources, open tasks, **blockers**, review
  items, and suggested next actions.
- Scope blockers to what is derivable from current graph state — open tasks with an unmet
  `taskDependsOn` edge. Do **not** depend on the agentic-trace/gap model from Sprint 4; that model is
  defined later and the dossier must ship a useful "where was I?" answer without it. Agentic *gaps*
  (missing-knowledge suggestions) are layered into the dossier in Sprint 4 under a clearly labelled
  provisional section. This removes the forward dependency that the prior draft created.
- Support deterministic sorting by accepted status, review priority, recency, and provenance.

**Acceptance:**

- A fixture graph produces a stable re-entry dossier.
- The dossier contains enough evidence for the user to resume work without re-reading all sources.
- At least one task in the dossier traces to a Claim, Excerpt, and Resource.

### Sprint 3: Provisional Routing And Review Priority

**Goal:** Convert "machine-assisted inbox-zero" from strategy into graph behavior.

**Why now:** The owner-response draft makes routing and selective review central. Classification
must become visible, provisional, and useful for prioritising human attention.

**Scope:**

- Extend classification metadata, treating it as a **delta over the existing `TagAssignment`
  schema** (`packages/phyla/src/schema/assignment.ts`), which already carries `confidence`, `source`
  (`manual | automatic | imported | inferred`), `assignedBy`, `assignedAt`, and `notes`. Reuse
  `source` for provenance rather than adding an overlapping `method` field.
- Place the new fields by grain (see Proposed Decisions For Review): `taxonomyVersion` is
  per-(claim,tag) and goes on `TagAssignment`; **routing review status/reason** is a claim-grain
  concept and uses separate Claim metadata fields (`routingReviewStatus`, `routingReviewReason`)
  validated in `reconditum/src/schema/domain-metadata.ts`. These fields must stay distinct from the
  Claim's existing *editorial* `state` (`draft | accepted | rejected`). Do not silently overload one
  "review" field for both the editorial lifecycle and routing confirmation — they are different axes
  a reviewer acts on independently.
- Add review-priority computation for low confidence, active project relevance, conflicts, missing
  explanation, and action implication.
- Add CLI output that labels provisional vs human-reviewed structure.

**Acceptance:**

- Low-confidence or action-implying items rise above low-value backlog in review output.
- Provisional routing is preserved across reruns and not silently promoted to human-approved state.
- Routing metadata is stored at the grain it governs: per-assignment taxonomy data on
  `TagAssignment`, claim-grain routing review data on typed Claim metadata.

### Sprint 4: Minimal Agentic Trace Model

**Goal:** Add inspectable agent-suggested relationships without confusing them with human-approved
graph topology.

**Why separate from Sprint 3:** Routing metadata and review priority are workflow improvements on
existing taxonomy assignments. Agentic traces introduce new graph semantics and should receive
isolated contract review, tests, and docs.

**Scope:**

- Define a minimal single-node `RationaleTrace` model before introducing multiple new node types or
  predicates.
- Record suggested links, possible gaps, and rationale text as provisional graph data in typed trace
  metadata (`traceKind`, affected node IDs, proposed predicate if any, rationale, confidence,
  `traceReviewStatus`). Use `open | rejected | promoted` for the first trace-review status enum.
- Keep traces distinct from approved predicates such as `taskMotivatedBy`, `taskDependsOn`, and
  `claimDerivedFrom`.
- Use deterministic trace IDs derived from kind, affected node IDs, proposed predicate, and rationale
  context so reruns can converge on the same provisional suggestion.
- Use existing `relatedTo` edges from the trace node to affected nodes for traversal while keeping
  affected node IDs in metadata for validation and export;
  do not add `SuggestedLink`, `Gap`, `supports`, `blocks`, or `requires` as first-pass graph schema
  concepts unless a failing test proves metadata plus `relatedTo` is insufficient.
- Add generic CLI commands to list, inspect, and reject traces. Defer promotion to a follow-up task
  unless the approved edge semantics are explicit and tested.
- Allow the project re-entry dossier to include a clearly labelled provisional trace section.

**Acceptance:**

- Agentic traces are inspectable and rejectable.
- Traces preserve affected node IDs, confidence, agent/model identity, prompt version, input context,
  and review status.
- No trace is silently promoted into human-approved graph structure.
- Any new NodeType or Predicate is protected by graph contract tests.

### Sprint 5: Quality Gates For Viability

**Goal:** Protect the activation loop with tests, evals, and docs.

**Why now:** AIDHA already has broad implementation. The risk is not lack of features; it is drift
between source vectors, graph semantics, and user-facing guarantees.

**Scope:**

- Add an offline viable-prototype acceptance test covering ingest -> query -> task -> re-entry ->
  export.
- Add graph contract tests for any new NodeType or Predicate.
- Add CLI integration tests for text and JSON outputs.
- Add deterministic output checks for the re-entry dossier.
- Update quickstart/runbook docs to use generic `aidha` commands where appropriate.

**Acceptance:**

- The activation loop has a no-network CI gate.
- Docs describe the current generic CLI instead of a YouTube-only mental model.
- `pnpm test`, targeted package builds, scoped Meminit checks, and `pnpm docs:build` pass or have
  recorded, specific blockers.

### Sprint 6: Personal-Use Pilot And Release Baseline

**Goal:** Run the prototype against a realistic personal workflow and decide whether it is viable.

**Why now:** The product thesis must be tested against re-entry and action conversion, not only
pipeline correctness.

**Scope:**

- Select one real dormant project and one active project.
- Ingest a small set of relevant sources.
- Run project re-entry.
- Create at least one task from a prior claim.
- Record time-to-next-action and whether further research was avoided.
- Apply the pre-registered viability bar in the Proposed Decisions section.
- Cut a release note if the loop is useful enough to keep using.

**Acceptance:**

- Evidence shows whether AIDHA reduced re-derivation or only accumulated more material.
- The release note states what is viable, what remains awkward, and what is explicitly deferred.

## Explicit Non-Priorities

Do not spend the next sprints on these unless a sprint acceptance gate proves they are blocking the
activation loop:

- More ingestion vectors beyond the already implemented PLAN-007 set.
- Embedding/vector/semantic retrieval. Generic query stays deterministic lexical/FTS for the
  prototype; semantic search would break the no-network and reproducibility guarantees and is
  deferred until after the activation loop is demonstrated.
- Browser extension, OS share targets, or tab-group capture.
- Full graph visualisation or a broad web UI.
- Dedicated graph database migration.
- Bidirectional Obsidian, Logseq, or Notion sync.
- Perfect taxonomy or complete ontology design.
- Autonomous graph restructuring.
- Direct multimodal mining.
- Broad-market polish.

## Quality Bar

Each sprint should meet the repository's atomic unit of change:

- failing test first;
- implementation;
- focused comments where needed;
- docs/runbook/quickstart updates;
- scoped DocOps check;
- package build and tests;
- `pnpm docs:build`;
- code review before commit.

For demonstration-class quality, each implemented sprint must also provide:

- a deterministic fixture or replayable command;
- human-readable output suitable for a maintainer demo;
- machine-readable output suitable for an agent;
- explicit evidence of provenance preservation;
- a short "what this proves" note in the PR or testing doc.

## Risks And Controls

| Risk | Control |
| ---- | ------- |
| Continuing to build ingestion breadth instead of product value | Defer new vectors until the activation loop is demonstrated. |
| Re-entry dossier becomes another large report, not an action aid | Keep the output constrained to claims, sources, open tasks, blockers (unmet `taskDependsOn`), optional agentic gaps, and next actions. |
| Agentic traces pollute human-approved graph structure | Store provisional traces distinctly and require explicit promotion. |
| Generic CLI duplicates YouTube logic | Extract reusable graph/query/task helpers and retire duplicate paths where possible. |
| Taxonomy work expands into ontology design | Start with routing metadata and review priority only. |
| Demo harness becomes brittle | Use no-network fixtures and deterministic clocks/IDs. |

## Decision Rule

When choosing between competing features, prefer the one that most directly improves:

1. trusted capture;
2. cross-source retrieval;
3. project re-entry;
4. claim-to-task conversion;
5. next-action clarity;
6. reduction of unnecessary further research.

Features that mainly improve architectural elegance, ingestion breadth, ontology completeness, or UI
polish should wait until the activation loop is demonstrably useful.

## Proposed Decisions For Review

These responses resolve the peer-review questions into actionable defaults. They remain reviewable
while the document is Draft, but coding agents should follow them unless a maintainer explicitly
changes the decision in this plan or a linked ADR.

| Decision | Proposed response | Implementation consequence |
| -------- | ----------------- | -------------------------- |
| Generic CLI vs. YouTube CLI | Make `@aidha/praecis-cli` the canonical user and agent surface for activation. Keep YouTube-specific activation commands only as temporary wrappers until generic parity exists. | New `query`, `task`, `review`, `project reentry`, and export work lands in generic CLI/shared core. Do not add new YouTube-only activation behavior. Once parity is demonstrated, either remove YouTube wrappers or mark them as deprecated aliases. |
| Routing metadata location | `taxonomyVersion` is per-(claim,tag) and belongs on `TagAssignment` because it records which taxonomy produced that placement. Routing review is claim-grain: a Claim has many `TagAssignment`s, so assignment-level routing review gives no clean answer to "is this claim's routing reviewed?", which is the grain `aidha review next` consumes. Reuse existing `source`, `confidence`, `assignedBy`, `assignedAt`, and `notes`; do not add a duplicate `method` field. | Default implementation: add optional `taxonomyVersion` to `TagAssignment` (`@aidha/phyla`), and add optional Claim metadata fields `routingReviewStatus` and `routingReviewReason` validated in `domain-metadata.ts`. Keep these separate from the existing editorial `state`. If a maintainer wants per-assignment review later, require an ADR because `review next` would need explicit aggregation semantics. A graph schema bump is only needed if new NodeTypes/Predicates are introduced. |
| Strategy reconciliation timing | Promote the resolved owner-response positions in parallel with Sprint 0, before Sprint 1 implementation branches are treated as ready for review. | Add Sprint 0A. Sprint 5 keeps quickstart/runbook reconciliation, but the strategic thesis must be governed before activation code relies on it. |
| Agentic trace scope | Split agentic traces out of routing/review-priority work. Sprint 3 handles routing and review priority; Sprint 4 handles trace graph semantics. Start with one `RationaleTrace` node model, not a family of trace node/predicate types. | Durable graph-contract changes for traces receive isolated tests and review. The re-entry dossier ships first using current graph blockers (`taskDependsOn`) and later gains a provisional trace section. |
| Pilot go/no-go bar | Treat the two-project pilot as directional product evidence, not a statistical claim. Pre-register a minimum viability bar before running it. | The prototype baseline can be tagged only if at least one pilot project yields a justified next action without reopening the original sources, at least one created/open task traces to Claim -> Excerpt -> Resource provenance, and the release note records both useful and noisy outputs. |

### Pilot Viability Bar

The Sprint 6 pilot is a go for a viable-prototype baseline only if all mandatory criteria pass:

- At least one of the two pilot projects produces a plausible next action from `aidha project
  reentry` without manually reopening the original source material first.
- At least one Task is created or confirmed from a prior Claim, and `task show` traces it to Claim,
  Excerpt, and Resource provenance.
- The dossier surfaces at least one prior source, claim, or task that the user would otherwise have
  had to re-derive or manually search for.
- The command path is reproducible enough that a coding agent can rerun the same demo harness and
  inspect the evidence packet.

The pilot is a no-go, or at least not a baseline candidate, if any of these conditions hold:

- The re-entry dossier mainly restates ingested material without supporting a next action.
- The user must manually inspect most original sources before trusting the dossier.
- Provenance is missing, ambiguous, or source-type-specific in a way that breaks cross-source trust.
- The release note cannot honestly distinguish useful activation from additional accumulation.

Passing this bar does not prove broad product-market usefulness. It proves only that the local
personal prototype has crossed the threshold from ingestion showcase to usable cognitive re-entry
tool for at least one real workflow.
