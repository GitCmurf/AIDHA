---
document_id: AIDHA-STRATEGY-002
type: STRATEGY
title: "AIDHA Product Vision"
status: Draft
version: "0.2"
last_updated: "2026-02-07"
owner: CMF
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-STRATEGY-002
> **Owner:** CMF
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-02-07
> **Type:** STRATEGY

## Version History

| Version | Date       | Author | Change Summary                                                     | Reviewers | Status | Reference |
| :------ | :--------- | :----- | :----------------------------------------------------------------- | :-------- | :----- | :-------- |
| 0.1     | 2026-02-07 | CMF    | Initial seed: name explanation, MVP scope, maturity aspiration     | —         | Draft  | —         |
| 0.2     | 2026-02-07 | AI     | Expand: full vision structure, principles, architecture, questions | —         | Draft  | —         |

---

# STRATEGY: AIDHA Product Vision

<!-- markdownlint-disable MD013 -->

## 1. Name and Identity

**AIDHA** — “Adaptive Intelligence for Directed Human Agency.”
(Primary mission: Augment human capacity to think, plan, learn, and execute with structure.)
**AIDHA** — “AI-Integrated Directed Hypergraph Assistant.”
(Internal technical description of the cognitive-graph backend.)

- These backronymic descriptions coexist as outer and inner layers.
- The mirroring of “Directed” in both expansions is deliberate:
  - outer “Directed” = human agency
  - inner “Directed” = graph topology and flow of reasoning
- The orthographic similarity to ADHD is a deliberate nod to the user profile that AIDHA is
  designed to scaffold and facilitate AI assistance for.

---

## 2. Problem Statement

Knowledge workers — and especially neurodivergent individuals — face a compounding problem:
they consume more information than they can retain, rediscover the same insights repeatedly,
and struggle to connect learning to action. Existing tools force a choice between:

- **Capture-heavy systems** (bookmarks, read-later apps, note vaults) that accumulate without
  structure, becoming graveyards of good intentions.
- **Task-heavy systems** (to-do lists, project managers) that track obligations but sever the
  link to the knowledge that motivated them.
- **AI-powered search** that retrieves information but does not preserve provenance, context,
  or the user's evolving understanding.

AIDHA addresses the gap between these categories: a system where **knowledge capture feeds
directly into structured action**, with provenance preserved end-to-end, and where AI
augments — but does not replace — human judgment.

---

## 3. Product Definition

**AIDHA** is a graph-native personal cognition management system that stores, organises, and
retrieves knowledge, integrated into project objectives and task breakdown structures. It is
designed to be used by a single person, and to assist them in managing their knowledge capture
and personal thoughts, obligations, and ambitions. It is not designed to be used by multiple
people, or to manage the knowledge of an organisation.

### Core value proposition

> **"Re-find beats re-think."**
> If you have already encountered an idea, extracted a claim, or created a task from it,
> AIDHA surfaces that prior work before you duplicate the effort.

### What AIDHA is not

- Not a general-purpose note-taking app (no freeform editor; structured graph nodes instead).
- Not a team collaboration tool (single-user, local-first by design).
- Not an autonomous AI agent (AI assists extraction and retrieval; the human curates and decides).
- Not a replacement for domain-specific tools (calendar, email, IDE); it is the connective
  tissue between learning and doing.

---

## 4. Target User Profile

The primary user is a **solo knowledge worker** who:

- Consumes learning material across multiple media (video, audio, articles, books).
- Manages personal projects, goals, and areas of responsibility.
- Experiences executive-function challenges (ADHD or similar) that make traditional
  organisational systems brittle under cognitive load.
- Values provenance and auditability — wants to know _where_ an idea came from and _why_
  a task exists.
- Is comfortable with CLI-first tooling and iterates toward richer interfaces over time.
- Operates primarily on a single machine (local-first) with occasional export/sharing needs.

---

## 5. Design Principles

These principles guide architectural and product decisions across all AIDHA packages.

### 5.1 Graph-native, not graph-adjacent

Knowledge, tasks, and their relationships are first-class graph citizens — not rows in a
relational table with graph queries bolted on. The graph topology _is_ the data model.
(See AIDHA-ADR-005, AIDHA-PRD-001.)

### 5.2 Provenance is non-negotiable

Every claim must trace back to its source excerpt, every excerpt to its resource, every task
to the claim that motivated it. If provenance is lost, the system's trustworthiness collapses.

### 5.3 Determinism as a quality gate

Exports, dossiers, and graph snapshots must be byte-stable given identical inputs. This
enables diffing, CI validation, and confidence in idempotent re-processing.
(See AIDHA-STRAT-001, AIDHA-PRD-001 NFR-1.)

### 5.4 AI-augmented, human-curated

AI performs high-recall extraction and classification. Humans perform curation (accept/reject/
edit) and strategic decisions (project assignment, goal alignment). The boundary between
AI-generated and human-approved content must always be visible.
(See AIDHA-ADR-006, AIDHA-ADR-007.)

### 5.5 Local-first, export-friendly

Data lives on the user's machine. Interoperability is achieved through deterministic exports
(JSON-LD, Markdown dossiers) rather than cloud sync or API dependencies.
(See AIDHA-PRD-001 NFR-2.)

### 5.6 Friction-aware design

Every interaction should respect the user's cognitive budget. Defaults must be safe and
productive (e.g., inbox-first collation, draft-state claims, batch review). The system should
never require a taxonomy decision before allowing capture.

### 5.7 DocOps as a first-class practice

Documentation is not an afterthought. Every feature ships with PRD, ADR, tests, quickstart,
and runbook — validated by CI. The MkDocs site is the canonical artifact.
(See AIDHA-ADR-001, AIDHA-GOV-001.)

---

## 6. Architecture Overview

AIDHA is structured as a pnpm monorepo with three interdependent packages, each with
dedicated PRD, ADR, and test coverage.

### 6.1 Package map

| Package                     | Name              | Role                                                                 | PRD           |
| :-------------------------- | :---------------- | :------------------------------------------------------------------- | :------------ |
| `packages/reconditum/`      | Graph Backend     | Cognition graph store, JSON-LD export, contract tests                | AIDHA-PRD-001 |
| `packages/phyla/`           | Taxonomy          | Classification schemas, tag registry, validation                     | AIDHA-PRD-003 |
| `packages/praecis/youtube/` | YouTube Ingestion | Transcript ingestion, two-pass claim extraction, dossier export, CLI | AIDHA-PRD-002 |

### 6.2 Data flow (MVP)

```text
YouTube URL/Playlist
        |
        v
  [Ingestion: fetch metadata + transcript]
        |
        v
  Resource node + Excerpt nodes (graph)
        |
        v
  [Pass 1: LLM candidate mining per chunk]
        |
        v
  CandidateClaim[] (cached, auditable)
        |
        v
  [Pass 2: deterministic editorial selection]
        |
        v
  Claim nodes (draft state) + provenance edges
        |
        v
  [Human review: accept / reject / edit / assign]
        |
        v
  Accepted Claims --> Dossier export (Markdown)
                  --> Graph export (JSON-LD)
                  --> Task creation (linked to claims)
                  --> Retrieval (CLI query)
```

### 6.3 Key architectural decisions

- **Storage-agnostic GraphStore contract** with pluggable backends (in-memory for tests,
  SQLite for persistence). See AIDHA-ADR-002, AIDHA-ADR-005.
- **Two-pass LLM extraction** separating high-recall mining from deterministic editorial
  filtering. See AIDHA-ADR-007.
- **Claim lifecycle states** (draft/accepted/rejected) with explicit curation boundary.
  See AIDHA-ADR-006.
- **Source-agnostic extraction interfaces** (`IIngestor`, `IChunker`, `ICandidateMiner`,
  `IEditor`, `IExporter`) designed for reuse across future ingestion vectors.

---

## 7. MVP Scope and Strategy

The MVP strategy (AIDHA-STRAT-001) proves the core value proposition with the smallest valid
end-to-end sequence, without requiring a graphical user interface.

### 7.1 MVP success criteria

1. Ingest a YouTube playlist and produce Resource + Excerpt nodes reliably.
2. Extract 10-20 auditable claims per video with timestamped provenance.
3. Store all objects in a typed graph model with stable, deterministic IDs.
4. Create a task from a claim in under 15 seconds via CLI.
5. Retrieve previously captured claims by keyword/project in under 10 seconds.
6. Export a deterministic Markdown dossier and JSON-LD snapshot.

### 7.2 Current MVP status (as of 2026-02-07)

The core MVP work plan (AIDHA-PLAN-002) steps 0-8 are complete:

- Graph store contract with SQLite + in-memory backends
- YouTube ingestion with idempotent upserts
- Two-pass LLM claim extraction with caching
- Reference extraction from transcripts/descriptions
- Markdown dossier export
- Inbox-first task creation from claims
- CLI retrieval with SQLite FTS
- Evaluation harness with fixture tests

Post-MVP strengthening (AIDHA-PLAN-003) has delivered:

- Claim review queue (`review next`, `review apply`)
- Retrieval upgrades (`related --claim`, accepted-first defaults)
- Task creation guardrails (suggest related claims)
- Diagnostic commands (`diagnose transcript`, `diagnose extract`)

### 7.3 Post-MVP ingestion vectors

The MVP uses YouTube as the first ingestion vector. The architecture is designed to
generalise to additional sources through the common extraction pipeline:

1. **Personal voice notes** — ASR (Whisper or similar) produces timestamped transcript
   segments, which feed directly into the existing Excerpt/Claim pipeline.
2. **Web pages and articles** — HTML-to-text extraction with section/paragraph addressing
   instead of timestamps.
3. **PDFs and office documents** — Page/offset addressing for excerpts.
4. **Meeting recordings** — Speaker diarisation + ASR, with speaker attribution on excerpts.

The reusable core is: **Resource -> Excerpts -> CandidateClaims -> Claims**, with only the
source-specific ingestor and deep-link format varying per source type.

---

## 8. Maturity Model

AIDHA's evolution is conceived in three phases. Each phase builds on the previous one and
unlocks new capabilities without invalidating prior work.

### Phase 1: Prove the workflow (MVP — current)

- **Interface:** CLI + Markdown dossiers.
- **AI role:** Extraction assistant (LLM claim mining, heuristic fallback).
- **Human role:** Full curation authority (review, accept, reject, assign).
- **Storage:** Local SQLite, single-user.
- **Value test:** "Can I ingest a playlist, extract useful claims, create tasks, and
  retrieve prior work faster than doing it manually?"

### Phase 2: Expand and harden

- **Interface:** Interactive CLI/TUI, then local web UI (dossier browser + task creation).
- **AI role:** Classification assistant (model-assisted tagging), retrieval enhancer
  (embedding-based similarity, semantic search).
- **Human role:** Curation with AI suggestions; taxonomy governance.
- **Storage:** Schema versioning, migrations, prompt versioning.
- **New ingestion vectors:** Voice notes, web pages, PDFs.
- **Value test:** "Can I trust the system enough to use it daily without babysitting it?"

### Phase 3: Integrated cognition partner

- **Interface:** Editor integration (e.g., Obsidian plugin, VS Code sidebar), possibly
  conversational interface.
- **AI role:** AI both queries and reshapes the graph — not merely sitting on top of it.
  This means AI can propose graph restructuring (merge duplicate concepts, suggest new
  connections, recommend project/goal alignment), subject to human approval.
- **Human role:** Strategic oversight; AI handles routine graph maintenance.
- **Storage:** Potential migration to dedicated graph database if traversal complexity
  warrants it.
- **Value test:** "Does the system actively surface insights and connections I would not
  have found on my own?"

> In maturity, AI both queries and reshapes the graph, not merely sits on top of it.
> "Integrated" is a key principle meaning much more than facilitation of RAG.

---

## 9. AI Integration Philosophy

The word "Integrated" in the technical backronym is deliberately chosen to signal a deeper
relationship between AI and the knowledge graph than typical RAG (Retrieval-Augmented
Generation) patterns.

### 9.1 Current state: AI as extraction tool

- LLM performs claim mining from transcripts (Pass 1).
- Deterministic post-processing curates the output (Pass 2).
- Human reviews and approves all AI-generated content.
- AI has no write access to the graph without human-initiated commands.

### 9.2 Near-term: AI as classification and retrieval assistant

- Model-assisted taxonomy tagging with confidence scores.
- Embedding-based similarity for `related` queries and duplicate detection.
- AI-suggested project/goal assignment during review.
- All suggestions are advisory; human confirms.

### 9.3 Long-term: AI as graph co-maintainer

- AI proposes graph restructuring (concept merging, relationship discovery).
- AI identifies knowledge gaps ("you have claims about X but no tasks acting on them").
- AI assists with "next action" advice based on graph topology and task dependencies.
- All structural changes require explicit human approval (no silent graph mutation).

### 9.4 Guardrails

- Every AI-generated or AI-modified node/edge must carry extraction metadata
  (`method`, `model`, `promptVersion`, `confidence`).
- The system must always distinguish between human-curated and AI-suggested content.
- Cost controls (max tokens, max spend per run) must be enforced at the pipeline level.
- LLM responses are cached deterministically to enable reproducible reruns.

---

## 10. Success Metrics

Success is measured differently at each maturity phase. Metrics should be observable
without instrumentation burden on the user.

### 10.1 Phase 1 (MVP) metrics

| Metric                  | Target                                                              | How measured                            |
| :---------------------- | :------------------------------------------------------------------ | :-------------------------------------- |
| Ingestion reliability   | ≥95% of videos in a playlist produce valid Resource + Excerpt nodes | CI fixture tests, manual playlist runs  |
| Claim yield             | 10–20 auditable claims per video                                    | Dossier inspection, evaluation harness  |
| Provenance completeness | 100% of claims trace to an excerpt with timestamp                   | Graph query assertion in contract tests |
| Retrieval latency       | <10 seconds for keyword/project lookup                              | CLI timing                              |
| Export determinism      | Byte-identical JSON-LD given identical input                        | CI diff test against fixtures           |
| Task creation speed     | <15 seconds from claim to task via CLI                              | Manual timing                           |

### 10.2 Phase 2 metrics

| Metric                  | Target                                                            | How measured             |
| :---------------------- | :---------------------------------------------------------------- | :----------------------- |
| Daily use retention     | User opens AIDHA ≥5 days/week for ≥4 weeks                        | Self-reported usage log  |
| Re-derivation avoidance | User retrieves prior claim instead of re-extracting ≥3 times/week | CLI history or usage log |
| Taxonomy coverage       | ≥80% of claims have at least one topic tag after review           | Graph query              |
| Classification accuracy | ≥70% of AI-suggested tags accepted without edit                   | Review queue stats       |

### 10.3 Phase 3 metrics

| Metric                   | Target                                                     | How measured  |
| :----------------------- | :--------------------------------------------------------- | :------------ |
| AI-surfaced insight rate | ≥1 non-obvious connection surfaced per week                | User-reported |
| Graph maintenance burden | <10 minutes/week on graph housekeeping                     | Self-reported |
| Cross-source linking     | ≥20% of claims link to claims from a different source type | Graph query   |

---

## 11. Interface Evolution Strategy

The interface strategy follows a progressive disclosure model, matching interface complexity
to system maturity and user trust.

### 11.1 Stage 1: CLI-first (current)

- All operations available via `aidha` CLI commands.
- Output is Markdown dossiers, JSON-LD exports, and terminal text.
- Suitable for power users comfortable with shell workflows.
- Validates the core value proposition without UI investment.

### 11.2 Stage 2: Interactive CLI / TUI

- Rich terminal UI for claim review queues (scrollable, keyboard-navigable).
- Fuzzy search and autocomplete for retrieval and taxonomy assignment.
- Graph visualisation in terminal (ASCII or Sixel if terminal supports it).
- Still local, no web server required.

### 11.3 Stage 3: Local web UI

- Lightweight local web server (no cloud dependency) for dossier browsing.
- Drag-and-drop claim review, task creation, and project assignment.
- Graph visualisation (D3 or similar) for exploring connections.
- Search with faceted filtering (source type, date range, tag, status).

### 11.4 Stage 4: Editor integration

- Obsidian plugin or VS Code sidebar for in-context knowledge retrieval.
- "What do I already know about X?" queries from within the writing/coding context.
- Bidirectional sync between editor notes and AIDHA graph nodes (if applicable).

> The key principle: each stage must be **independently valuable**. The user should never
> be forced to upgrade interfaces to access core functionality.

---

## 12. Scope Boundaries and Non-Goals

Explicit boundaries prevent scope creep and keep the project focused.

### 12.1 In scope

- Single-user personal knowledge and task management.
- AI-assisted extraction, classification, and retrieval.
- Local-first storage with deterministic export.
- CLI-first interface evolving toward richer UIs.
- YouTube as the first (and currently only) ingestion vector.

### 12.2 Out of scope (non-goals)

- **Multi-user or team collaboration.** AIDHA is a personal tool. Sharing is handled
  through export, not through access control or sync.
- **Real-time collaboration.** No conflict resolution, no CRDTs, no multi-device sync.
- **Cloud hosting or SaaS.** AIDHA runs on the user's machine. There is no server to
  deploy or maintain.
- **General-purpose note editing.** AIDHA is not Obsidian, Notion, or Roam. It manages
  structured graph nodes, not freeform documents.
- **Autonomous AI agents.** AI assists and suggests; it does not act without human
  initiation. No background processing, no unsupervised graph mutation.
- **Enterprise features.** No audit logs for compliance, no role-based access control,
  no SSO integration.
- **Mobile applications.** Desktop-first; mobile access is a distant future consideration.

---

## 13. Strategic Open Questions

The following questions are unresolved and materially affect the product vision. They are
grouped by theme and ordered by urgency within each group. Each question includes a brief
rationale explaining why answering it matters.

> **Instructions for the owner:** Answer directly below each question (replace the
> placeholder). These responses will be incorporated into the next revision of this document.

---

### Theme A: User Experience

**Q1. What does "daily use" actually look like?**

_Rationale:_ The Phase 2 success metric targets ≥5 days/week usage, but the vision does not
describe the daily workflow. Understanding the trigger-action-reward loop (what prompts the
user to open AIDHA, what they do, and what they gain) is essential for interface design and
feature prioritisation.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q2. When does CLI become insufficient, and what should replace it first?**

_Rationale:_ The interface evolution strategy (Section 11) lists four stages but does not
specify the trigger for moving to Stage 2. Is it a particular task (e.g., reviewing 50+
claims), a particular frustration (e.g., lack of visual graph overview), or a particular
user count threshold? The answer shapes the next engineering investment.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q3. How should AIDHA handle the "capture vs. curate" tension?**

_Rationale:_ The system currently requires human review of all claims. As ingestion volume
grows (multiple playlists, voice notes, articles), the review backlog could become a source
of the same cognitive overwhelm AIDHA is designed to reduce. What is the acceptable ratio
of uncurated-to-curated content, and should the system auto-accept claims above a confidence
threshold?

> **Owner response:** <!-- REPLACE WITH ANSWER -->

---

### Theme B: Technical Architecture

**Q4. When (if ever) should AIDHA migrate from SQLite to a dedicated graph database?**

_Rationale:_ SQLite is correct for MVP (AIDHA-ADR-002), but the storage-agnostic contract
(AIDHA-ADR-005) was designed to allow migration. What graph size, query complexity, or
traversal depth would trigger this decision? The answer affects whether to invest in the
GraphStore abstraction or lean into SQLite-specific optimisations.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q5. How will schema evolution be managed as the graph model matures?**

_Rationale:_ The current node/edge schema is defined in code and tested via contract tests.
As new node types (e.g., Goal, Area) and edge types are added, what migration strategy
applies? Does the system need versioned schemas, migration scripts, or a more flexible
property-graph approach? This affects data durability and upgrade confidence.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q6. What is the prompt versioning and regression strategy?**

_Rationale:_ The two-pass extraction architecture depends on LLM prompts that will evolve.
Changing a prompt can change extraction output for the same input. How are prompt versions
tracked, how are regressions detected (e.g., evaluation harness against golden fixtures),
and when is a prompt change considered "breaking"?

> **Owner response:** <!-- REPLACE WITH ANSWER -->

---

### Theme C: AI Integration

**Q7. Where exactly is the boundary between AI autonomy and human control?**

_Rationale:_ Section 9 describes a progression from "extraction tool" to "graph
co-maintainer," but the boundary is fuzzy. Specifically: should AI ever create a node
without explicit human initiation (e.g., auto-extracting claims from a newly ingested
resource)? Should AI ever modify an existing node's properties? The answer defines the
trust model for the entire system.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q8. How should AI extraction quality be evaluated beyond fixture tests?**

_Rationale:_ The current evaluation harness tests against golden fixtures, which validates
determinism but not quality. How should claim relevance, accuracy, and completeness be
measured? Is there a human-in-the-loop evaluation cadence (e.g., monthly sample review)?
This affects whether the system can confidently adopt new models or prompts.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

---

### Theme D: Scope and Ecosystem

**Q9. Should AIDHA integrate with existing PKM tools (Obsidian, Logseq, Notion)?**

_Rationale:_ Section 12 declares AIDHA is "not Obsidian," but many potential users already
have an Obsidian vault. Is AIDHA complementary (feeding structured claims into Obsidian
via export) or competitive (replacing the vault)? The answer affects export format
priorities and whether bidirectional sync is ever on the roadmap.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q10. Is AIDHA ever multi-user, even in a limited form?**

_Rationale:_ The vision firmly declares single-user scope. But what about sharing a curated
dossier with a collaborator, or importing someone else's exported graph? "Sharing via
export" is already in scope; the question is how far that extends before it becomes
multi-user collaboration.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

---

### Theme E: Success and Sustainability

**Q11. How do you measure "re-find beats re-think" quantitatively?**

_Rationale:_ The core value proposition (Section 3) is compelling but hard to measure. What
observable behaviour indicates that a user retrieved prior work instead of re-deriving it?
CLI history analysis? A "previously captured" indicator in search results? Without a
measurable proxy, the value proposition remains aspirational.

> **Owner response:** <!-- REPLACE WITH ANSWER -->

**Q12. What is the sustainability model for this project?**

_Rationale:_ AIDHA is currently a solo personal project. If it proves valuable, what keeps
it maintained? Is it purely personal infrastructure (maintained as long as the owner uses
it), open-source with community contributions, or potentially a product? The answer affects
documentation depth, API stability commitments, and whether the codebase needs to be
legible to outside contributors.

> **Owner response:** <!-- REPLACE WITH ANSWER -->
