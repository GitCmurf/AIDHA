---
document_id: AIDHA-PLAN-008
owner: Product
status: Draft
version: "0.1"
last_updated: 2026-05-30
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
> **Version:** 0.1
> **Last Updated:** 2026-05-30
> **Type:** PLAN

# Viable Prototype Sprint Plan

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-30 | AI     | Initial plan derived from strategy, planning, and codebase review. | - | Draft | AIDHA-TASK-010 |

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

1. **Activation is not yet the generic product surface.** The generic `aidha` CLI can ingest across
   vectors, but review, query, task creation, project context, and dossier/re-entry flows still sit
   mostly in the YouTube package or are incomplete at the generic layer.
2. **The operational graph is under-surfaced.** Node and predicate support exists for Project, Goal,
   Area, Task, and task provenance, but the user cannot yet rely on one cross-vector flow to answer:
   "What did I already know, what did I decide, and what should I do next?"
3. **Routing remains too shallow for the refined strategy.** Keyword taxonomy assignment exists, but
   the prototype needs visible provisional placement, confidence, method, taxonomy version, review
   status, and reasons for review priority.
4. **Agentic traces are not yet first-class.** The strategy calls for inspectable suggested links,
   gaps, and rationale traces that are distinct from human-approved structure.
5. **Demonstrability is weaker than implementation breadth.** The repo has many working components,
   but no single demonstration-class script proves capture -> route -> re-entry -> task -> export
   on a clean local store.
6. **Planning and strategy drift need reconciliation.** AIDHA-PLAN-007 and current code moved beyond
   the older YouTube-only docs; the owner-response draft for AIDHA-STRATEGY-002 has not yet been
   promoted into a governed strategy revision.

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

- Define a fixture-backed viable-prototype scenario using at least two source types.
- Build a local acceptance command that creates a fresh store, runs ingestion, captures outputs, and
  writes a demo evidence directory.
- Record which user-facing flows are generic today and which still depend on YouTube-specific CLI
  commands.
- Add a short testing note under `docs/55-testing/` after the script exists.

**Acceptance:**

- A single command produces a fresh demonstration packet under `out/` or `docs/55-testing/`.
- The packet includes source summaries, claim IDs, provenance, and deterministic rerun evidence.
- The gap list is current and linked from AIDHA-TASK-010.

### Sprint 1: Generic Activation CLI

**Goal:** Move the user's core activation operations into `@aidha/praecis-cli`.

**Why now:** Multi-vector ingestion is not enough. A user needs one CLI surface for retrieval,
review, task creation, and context restoration regardless of source type.

**Scope:**

- Add generic graph query helpers in `@aidha/praecis-core` or `@aidha/praecis-cli`.
- Add generic `aidha query` with JSON and readable text output.
- Add generic `aidha task create --from-claim` and `aidha task show`.
- Add generic `aidha review next` for draft/provisional claims.
- Keep output deterministic and machine-readable.

**Acceptance:**

- The generic CLI can query claims ingested from more than one vector.
- A task can be created from any Claim node, not just YouTube claims.
- Task context follows `taskMotivatedBy`, `claimDerivedFrom`, and `resourceHasExcerpt` links.
- YouTube-specific activation code is reused or migrated rather than duplicated.

### Sprint 2: Project Re-entry Dossier

**Goal:** Make AIDHA answer "where was I?" for a project.

**Why now:** This is the clearest test of the refined strategy. It directly measures cognitive
continuity and makes the product more than an ingestion engine.

**Scope:**

- Define a typed `ProjectReentryDossier` model.
- Add `aidha project reentry --project <id>` with `--json` and `--markdown` output.
- Include project metadata, related claims, supporting sources, open tasks, blockers/gaps, review
  items, and suggested next actions.
- Support deterministic sorting by accepted status, review priority, recency, and provenance.

**Acceptance:**

- A fixture graph produces a stable re-entry dossier.
- The dossier contains enough evidence for the user to resume work without re-reading all sources.
- At least one task in the dossier traces to a Claim, Excerpt, and Resource.

### Sprint 3: Provisional Routing, Review Priority, And Rationale Traces

**Goal:** Convert "machine-assisted inbox-zero" from strategy into graph behavior.

**Why now:** The owner-response draft makes routing and selective review central. Classification
must become visible, provisional, and useful for prioritising human attention.

**Scope:**

- Extend classification metadata with taxonomy version, method, confidence, assigned-by, assigned-at,
  review status, and review reason.
- Add review-priority computation for low confidence, active project relevance, conflicts, missing
  explanation, and action implication.
- Add minimal graph support for agentic traces: suggested links, gaps, and rationales must be
  inspectable and separate from human-approved edges.
- Add CLI output that labels provisional vs human-reviewed structure.

**Acceptance:**

- Low-confidence or action-implying items rise above low-value backlog in review output.
- Provisional routing is preserved across reruns and not silently promoted to human-approved state.
- Agentic traces can be listed, inspected, promoted, weakened, or rejected in a later sprint.

### Sprint 4: Quality Gates For Viability

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

### Sprint 5: Personal-Use Pilot And Release Baseline

**Goal:** Run the prototype against a realistic personal workflow and decide whether it is viable.

**Why now:** The product thesis must be tested against re-entry and action conversion, not only
pipeline correctness.

**Scope:**

- Select one real dormant project and one active project.
- Ingest a small set of relevant sources.
- Run project re-entry.
- Create at least one task from a prior claim.
- Record time-to-next-action and whether further research was avoided.
- Cut a release note if the loop is useful enough to keep using.

**Acceptance:**

- Evidence shows whether AIDHA reduced re-derivation or only accumulated more material.
- The release note states what is viable, what remains awkward, and what is explicitly deferred.

## Explicit Non-Priorities

Do not spend the next sprints on these unless a sprint acceptance gate proves they are blocking the
activation loop:

- More ingestion vectors beyond the already implemented PLAN-007 set.
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
| Re-entry dossier becomes another large report, not an action aid | Keep the output constrained to claims, sources, open tasks, blockers/gaps, and next actions. |
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
