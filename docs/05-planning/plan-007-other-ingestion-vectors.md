---
document_id: AIDHA-PLAN-007
owner: Ingestion Engineering Lead
status: Draft
version: "0.4"
last_updated: 2026-05-20
title: Other Ingestion Vectors
type: PLAN
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PLAN-007
> **Owner:** Ingestion Engineering Lead
> **Approvers:** GPT (adversarial), Gemini (adversarial), Self-review
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-05-20
> **Type:** PLAN

<!-- markdownlint-disable MD013 -->

# Other Ingestion Vectors

## Version History

| Version | Date       | Author | Change Summary                                                                                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-05-20 | AI     | Initial plan: four-axis composition architecture, eight fully-specified vectors, phased execution.      | —         | Draft  | —         |
| 0.2     | 2026-05-20 | AI     | Pre-review hardening: resolve byte-identical contradiction (semantic-equivalence gate), define `ComposedVector`, scope determinism to cache/mocks, split `.eml`/`.msg`, add `text` Locator kind, per-Resource sensitivity routing, Zotero/screenshot roadmap, PRD-002 revision task. | Self-review (advisor) | Draft | — |
| 0.3     | 2026-05-20 | AI     | Codex adversarial-review fixes: (1) email Resource identity moved to thread level (`email:thread:<rootMessageId>` with a spelled-out derivation; messages are excerpts) and Objective de-advertised "tagged Outlook" to honest file-import scope; (2) defined the Readwise `source_url`→`web:<canonicalUrl>` work-id derivation so the RSS↔Readwise dedup gate is achievable, with merge/link integration cases pinned; (3) cleaned up three residual `byte-identical` references v0.2 missed (Phase 0 checklist, Risks table, DoD #2). | GPT (adversarial via Codex), Self-review (advisor) | Draft | — |
| 0.4     | 2026-05-20 | AI     | Showcase-excellence hardening: align the dependency gate to the live `SourceRegistration` baseline; separate acquisition helpers from decode strategies; make typed graph metadata and new edge predicates explicit; fix RSS canonical precedence so RSS↔Readwise merge is actually reachable; add email thread reparenting for out-of-order imports; add chunking policy ownership, dedup-key semantics, and sharper verification gates. | Codex adversarial review, Self-review | Draft | — |

## Objective

Extend AIDHA ingestion beyond the YouTube transcript proof-of-concept to eight
fully-specified vectors — **web pages, PDFs/documents, RSS articles, voice notes,
multi-person meetings, podcasts, Readwise highlights, and Outlook/email via file
import (`.eml` in v1; `.msg` only as a stretch; tag-triggered Graph API sync
deferred to AIDHA-PLAN-008)**,
plus a LinkedIn paste bridge — on a single reusable extraction spine, without
re-implementing the pipeline per source.

## Executive Summary

The MVP proved one ingestion vector (YouTube) end-to-end: `Resource → Excerpt →
CandidateClaim → Claim` with timestamped provenance, two-pass LLM extraction, and
deterministic dossier/JSON-LD export. The pipeline logic, however, currently lives
inside `packages/praecis/youtube/` and is implicitly coupled to timestamp-based
addressing and YouTube-specific acquisition.

This plan generalises that work using a **four-axis composition architecture**
(not an inheritance hierarchy). Every vector is expressed as a thin, declarative
composition of:

1. **Acquire** — source-specific retrieval, canonical ID, provenance, sensitivity.
2. **Decode** — modality → addressable `MediaSegment[]` (each carrying a typed
   `Locator` plus **either resolved `text` or a `mediaRef`**).
3. **Contextualize** — a sidecar `ExtractionContext` (domain hints, topics,
   related projects, show notes) injected into the miner.
4. **Extract** — the unchanged shared pipeline: `chunk → mine → edit → claim → export`.

The architecture deliberately separates two orthogonal concerns the PoC conflated:
**source/provenance** (where content came from) and **modality/processing** (how it
reaches the model chain). This is what lets "voice note", "meeting", and "podcast"
share almost all logic and differ only by *added decode steps* (diarisation) and
*context richness* — composition, not subclassing.

A new shared package `packages/praecis/core/` owns the spine; reusable decode
strategies live in `packages/praecis/decode/*`; reusable acquisition helpers
(`webfetch`, feed parsing, file-byte readers) live in `packages/praecis/acquire/*`;
each vector is a thin adapter under `packages/praecis/sources/*`. Vectors register
through the `SourceRegistration` contract delivered by AIDHA-PLAN-005 and present
in the current baseline (`@aidha/config` + the YouTube source adapter). That
contract is a baseline dependency, not work re-derived by this plan.

> [!IMPORTANT]
> AIDHA is pre-alpha with **no persisted production graphs** — only throwaway test
> fixtures. Schema changes are therefore clean breaks: there is **no migration or
> backward-compatibility requirement** for `reconditum`. This materially simplifies
> the `Locator` schema change in Section 4.

### Reader Map

- **Sections 1–2** establish current state, the gap, and design principles.
- **Section 3** defines the architecture: the two orthogonal axes, the four
  composition axes, the composition-over-inheritance rationale, the core types,
  the layering rule, and the package map.
- **Section 4** specifies the `reconditum` schema delta (Locator union, SourceType
  extension, multi-provenance, Locator-aware export).
- **Section 5** defines the composition framework interface contracts.
- **Section 6** fully specifies all eight vectors (plus the LinkedIn paste bridge).
- **Section 7** covers cross-cutting concerns (privacy, dedup-and-link, cost,
  config, determinism, transcription/diarisation backends).
- **Section 8** is the phased execution plan with acceptance gates.
- **Sections 9–14** cover verification, security, adversarial-review resilience,
  risks, open questions, and the definition of done.
- **Appendices** carry the Tier-2/3 vector roadmap and example configs.

### Non-Goals (Explicit Scope Exclusions)

- **Browser extension, share targets, OS share-receiver, and tab-group capture.**
  The web vector ships a CLI URL front-end in this plan; richer capture front-ends
  are deferred to a future plan (AIDHA-PLAN-008). The web ingestor is *architected*
  for them (it accepts a pre-fetched DOM/HTML payload) but does not build them here.
- **Microsoft Graph API email sync.** Email ships `.eml` file-import here (`.msg`
  only if the stretch parser is taken); tag-triggered Graph API sync is deferred to
  AIDHA-PLAN-008.
- **Authenticated LinkedIn fetching / scraping.** LinkedIn ships a paste bridge
  only; authenticated capture is extension-dependent and deferred.
- **Direct-multimodal claim mining** (sending audio/image bytes straight to a
  multimodal model). The `mediaRef` seam is modelled from day one, but only the
  text decode path is *implemented* in this plan.
- **Real-time / streaming ingestion** and **multi-user** anything (per AIDHA-STRATEGY-002 §12).
- **Tier-2/Tier-3 vectors** (Kindle, GitHub, Calendar, Slack, Twitter/X, Obsidian).
  These are roadmap-only (Appendix A).

---

## Technical Context

- **Language/runtime:** TypeScript (ESM), Node.js. pnpm monorepo.
- **Existing packages:** `packages/reconditum` (graph backend, `@aidha/graph-backend`),
  `packages/phyla` (taxonomy, `@aidha/taxonomy`), `packages/praecis/youtube`
  (ingestion PoC), `packages/aidha-config` (`@aidha/config`).
- **New packages introduced by this plan:**
  - `packages/praecis/core` — pipeline spine, composition framework, core types.
  - `packages/praecis/decode/text` — HTML/PDF/email text extraction.
  - `packages/praecis/decode/transcribe` — `ITranscriber` + backends.
  - `packages/praecis/decode/diarize` — `IDiarizer` + backends.
  - `packages/praecis/decode/ocr` — scanned-document OCR fallback.
  - `packages/praecis/acquire/webfetch` — `IWebFetcher` + backends.
  - `packages/praecis/acquire/feed` — feed parsing helpers shared by RSS/podcast.
  - `packages/praecis/sources/{web,pdf,feeds,voice,meetings,readwise,email,linkedin}`.
- **Testing:** Vitest per package (`pnpm -C <pkg> test`). No-network CI is mandatory
  (per AIDHA-PRD-002 NFR-1): every network/model/subprocess boundary is an injected
  interface with a deterministic mock.
- **Constraints:** deterministic outputs (AIDHA-STRATEGY-002 §5.3); local-first,
  export-friendly (§5.5); provenance non-negotiable (§5.2); AI-augmented,
  human-curated (§5.4); DocOps as first-class (§5.7).

## Constitution Check

1. **Graph-native scope:** new vectors create only graph-native nodes/edges
   (`Resource`, `Excerpt`, `Claim`, `Reference`, `Provenance`) via the GraphStore
   contract (AIDHA-PRD-001). No relational side-tables.
2. **Provenance:** every Excerpt carries a typed `Locator`; every Resource carries
   one or more `Provenance` records. Dedup never discards provenance (Section 7.2).
3. **AI-augmented, human-curated:** all vectors feed the existing draft→review→accept
   claim lifecycle (AIDHA-ADR-006). No vector auto-accepts claims.
4. **Determinism as a quality gate:** acquisition and model calls are cached; given
   identical inputs, exports are byte-stable (AIDHA-PRD-001 NFR-1).
5. **TDD strategy:** each phase begins with failing contract tests; mocks at every
   IO boundary keep CI offline.
6. **DocOps impacts:** each vector ships a runbook + quickstart update; `pnpm
   docs:build` and DocOps checks stay green.
7. **pnpm workspace changes:** new leaf packages with explicit, minimal dependency
   graphs (`core` depends on `reconditum`/`phyla`/`config`; `acquire/*` and
   `decode/*` depend on `core` types; `sources/*` depend on `core` plus the
   acquisition/decode helpers they compose).

## Terminology

- **Vector** — a named ingestion source (e.g. `web`, `voice`) expressed as a
  composition of the four axes plus a `SourceRegistration`.
- **MediaSegment** — the atomic addressable unit produced by Decode: a `Locator`
  plus either resolved `text` or a `mediaRef`, plus optional speaker/section labels.
- **Locator** — a discriminated union describing *where in a source* a segment lives
  (timecode, page, dom, message, text, or external id).
- **ExtractionContext** — sidecar metadata injected into the candidate miner prompt
  to improve relevance (domain, topics of interest, related projects, show notes).
- **Canonical ID** — the stable, content-or-identity-derived `Resource` node ID used
  for idempotency and cross-vector dedup.
- **Sensitivity tier** — `public | personal | confidential`; governs whether a
  vector's content may be sent to a cloud LLM (Section 7.1).
- **Decode strategy** — a reusable transform (`text-extract`, `transcribe`,
  `diarize`, `ocr`) that a vector composes into its decode chain.

---

## 1. Current State and Gap Analysis

### What Exists Today

| Capability | Where it lives | Coupling problem |
| ---------- | -------------- | ---------------- |
| Ingestion orchestration | `packages/praecis/youtube/src/pipeline/ingest.ts` (`IngestionPipeline`) | Hard-wired to `YouTubeClient`; constructor takes a concrete client, not an acquisition interface. |
| Two-pass extraction | `packages/praecis/youtube/src/extract/*` | Source-agnostic in spirit, but imported only by the YouTube package; not extractable as-is. |
| Excerpt addressing | `Excerpt` node `metadata` (untyped `z.record`) + `export/types.ts:5-8` (`timestampSeconds`, `timestampLabel`, `timestampUrl`) | Timestamp-native; assumes every excerpt is time-addressable. No typed locator. |
| Provenance | `packages/reconditum/src/schema/knowledge.ts:29-43` (`Provenance`, single optional object) | One provenance per item; cannot represent "same resource seen via two vectors". |
| Source typing | `reconditum` `SourceType` enum (`youtube, article, book, note, import, generated`) (`knowledge.ts:15-22`) | Closed enum; missing `web, pdf, voice, meeting, podcast, rss, readwise, email, linkedin`. |
| Config / sources | `@aidha/config` `SourceRegistration` contract and YouTube registration adapter | Present in the current baseline; this plan consumes it and extends it to the new vectors. |

### The Gap

1. **No reusable pipeline package.** Pipeline logic must be extracted from
   `praecis/youtube` into `praecis/core` so other vectors do not copy it.
2. **No typed addressing abstraction.** Timestamp-hardcoded excerpts and export
   types block page/dom/message addressing.
3. **No acquisition/decode abstraction.** Each vector needs an `IIngestor` it
   implements; fetching/feed parsing need acquisition helpers, while
   transcription/diarisation/OCR/text extraction need injectable decode strategies.
4. **No multi-provenance / dedup-and-link.** The schema cannot model a canonical
   resource reached through several vectors.
5. **No multi-vector registration inventory.** `SourceRegistration` exists for
   YouTube, but the new vector packages still need concrete registrations,
   `activeSourceConfig` validators, redaction metadata, path resolution, and CLI
   command bindings.

### Baseline Dependency Gate (Verify Before Phase 0)

> plan-007 Phase 0 **MUST** start from a branch that includes AIDHA-PLAN-005's
> `SourceRegistration` work (`packages/aidha-config/src/types.ts`,
> `packages/praecis/youtube/src/config/youtube-source-adapter.ts`,
> `source-schema.test.ts`, `cli-source-selection.test.ts`). The current worktree
> already contains that contract via `feat/user configuration profiles (#15)`.
> If another implementation branch lacks it, stop and rebase/merge before starting
> Phase 0. plan-007 consumes the contract; it does not fork or redesign it.

---

## 2. Design Principles

1. **Composition over inheritance.** Vectors compose strategies; they do not extend
   each other. There is no `Meeting extends Voice` class chain (Section 3.3).
2. **Modality-first, source-second.** The first discriminator is *what enters the
   model chain* (text now; audio/image later), expressed via `MediaSegment`. The
   source determines acquisition and provenance, not pipeline shape.
3. **One spine, many adapters.** `chunk → mine → edit → claim → export` is written
   once in `praecis/core`. A new vector is a thin adapter, not a new pipeline.
4. **Provenance is additive.** Dedup merges resources but **always** appends the new
   provenance and an `alsoSeenVia` edge; distinct-but-related resources use
   `corroboratedBy`. No provenance is ever discarded.
5. **Privacy is a first-class gate.** Every vector declares a sensitivity tier;
   confidential content can be barred from cloud LLMs by config.
6. **Determinism end-to-end.** Every non-deterministic boundary (network, model,
   subprocess, clock) is injected and cached, so fixtures pin behaviour.
7. **Future-proof seams, present-tense scope.** Model the `mediaRef` (direct
   multimodal) and authenticated-fetch seams now; build only the text path now.
8. **No over-abstraction.** The framework is plain composed functions plus a
   registration record — not a DI container or a plugin runtime.

---

## 3. Architecture

### 3.1 Two Orthogonal Axes

The PoC conflated two independent concerns. This plan separates them:

| Axis | Question it answers | Determines |
| ---- | ------------------- | ---------- |
| **Source / provenance** | *Where did this come from?* | Acquisition mechanism, canonical ID, provenance, sensitivity tier, locator *kind*. |
| **Modality / processing** | *What form is it in, and how does it reach the model?* | The decode chain (text-extract / transcribe / diarize / ocr), and whether the miner reads text or media. |

A **vector is the composition of a source with a processing chain.** Two vectors
can share a source family but differ in processing (voice note vs meeting: same
audio source family, meeting adds diarisation), or share processing but differ in
source (podcast vs voice note: both transcribe audio, different acquisition and
context).

### 3.2 The Four Composition Axes

Every vector is a declarative composition of four axes:

```text
        ┌─────────────┐   ┌─────────────┐   ┌────────────────┐   ┌──────────────────────────────┐
 source │  ACQUIRE    │ → │   DECODE    │ → │ CONTEXTUALIZE  │ → │           EXTRACT            │
        │ bytes/stream│   │ MediaSegment│   │ ExtractionCtx  │   │ chunk→mine→edit→claim→export │
        │ + canon. ID │   │   [ ]       │   │ (sidecar)      │   │       (shared spine)         │
        │ + provenance│   │ Locator +   │   │                │   │                              │
        │ + sensitivity│  │ text|mediaRef│  │                │   │                              │
        └─────────────┘   └─────────────┘   └────────────────┘   └──────────────────────────────┘
         per-source        shared, swappable   shared shape         written once in praecis/core
```

1. **Acquire** (`IIngestor`) — source-specific. Retrieves raw input, computes the
   canonical Resource ID, builds the `Provenance` record, and declares the
   sensitivity tier. Output: a `RawSource` (handles + metadata), not decoded
   `MediaSegment`s. Acquisition may use shared helpers (`IWebFetcher`, feed parser,
   file-byte reader), but those helpers are not pipeline stages.
2. **Decode** (`IDecodeStrategy[]`) — turns raw input into `MediaSegment[]`. A vector
   composes an ordered chain: e.g. `[transcribe]` (voice), `[transcribe, diarize]`
   (meeting), `[text-extract]` (web), `[text-extract or ocr]` (PDF). Each strategy
   is reusable across vectors and injectable for tests.
3. **Contextualize** (`IContextProvider`) — produces an `ExtractionContext` sidecar
   from source metadata and user config (domain hints, topics of interest, related
   projects, show notes, thread subject). Thin for a voice note; rich for a podcast.
4. **Extract** (the spine) — the unchanged `chunk → mine → edit → claim → export`
   pipeline in `praecis/core`, parameterised by the `ExtractionContext` and aware of
   `Locator` kinds for deep-link rendering.

### 3.3 Composition Over Inheritance (Rationale)

The intuitive mental model — "a meeting is a voice note plus diarisation; a podcast
is a voice note plus context" — is **correct about the relationships but wrong about
the mechanism if expressed as inheritance.** A class chain (`Meeting extends Voice
extends Audio extends Ingestor`) is the brittle deep hierarchy modern practice
avoids: it forces every shared change through a base class, couples unrelated
vectors, and breaks the moment a vector needs to *omit* an inherited step.

Composition expresses the same relationships without the coupling:

| Vector | Acquire | Decode chain | Context richness |
| ------ | ------- | ------------ | ---------------- |
| Voice note | local audio file | `[transcribe]` | thin (user tag) |
| Meeting | recording file | `[transcribe, diarize]` | rich (attendees, agenda) |
| Podcast (mono) | feed enclosure | `[transcribe]` | rich (show notes) |
| Podcast (panel) | feed enclosure | `[transcribe, diarize]` | rich (show notes) |
| YouTube | yt-dlp | `[fetch-captions] ?? [transcribe]` | rich (description) |
| Web | webfetch | `[text-extract]` | medium (page meta) |
| PDF | file | `[text-extract] ?? [ocr]` | medium (title/abstract/DOI) |
| RSS article | feed item | `[text-extract]` | medium (feed meta) |
| Email | file (`.eml`; `.msg` stretch) | `[text-extract]` (+ reply-strip) | medium (thread subject) |
| Readwise | REST API | `[passthrough]` (already segments) | medium (source meta) |
| LinkedIn | clipboard/stdin | `[passthrough]` | thin |

"Meeting" is voice's decode chain **plus** a `diarize` step — a one-line difference
in a composition record, not a subclass. This table *is* the design: adding a vector
means writing an `IIngestor`, choosing decode strategies, and registering. The
`mediaRef` seam (Section 3.4) means a future "direct audio" vector simply omits
`transcribe` and lets the miner consume audio directly — no refactor.

### 3.4 Core Types

Defined in `packages/praecis/core/src/types/`. These are the load-bearing contracts.

```ts
// locator.ts — discriminated union; replaces timestamp-hardcoded addressing.
export type Locator =
  | { kind: 'timecode'; startSec: number; endSec: number; speaker?: string }
  | { kind: 'page'; page: number; charStart: number; charEnd: number }
  | { kind: 'dom'; textFragment: string; charStart: number; charEnd: number }
  | { kind: 'message'; messageId: string; charStart: number; charEnd: number }
  | { kind: 'text'; charStart: number; charEnd: number }   // raw text with no source addressing (e.g. pasted)
  | { kind: 'external'; system: string; externalId: string };

// media-segment.ts — the atomic addressable unit produced by Decode.
export interface MediaSegment {
  /** Stable within a Resource; derived deterministically (Section 7.5). */
  id: string;
  locator: Locator;
  /** Resolved text for the v1 text path. Mutually exclusive with mediaRef in practice. */
  text?: string;
  /** Future seam: handle to raw media for direct-multimodal mining. Not consumed in v1. */
  mediaRef?: { uri: string; mimeType: string; startSec?: number; endSec?: number };
  /** Optional speaker label (diarisation) or section heading (documents). */
  label?: string;
}

// extraction-context.ts — sidecar injected into the miner prompt.
export interface ExtractionContext {
  domainHints?: string[];
  topicsOfInterest?: string[];
  relatedProjectIds?: string[];
  /** Hints for selecting a chunking policy without hard-coding source types. */
  chunkingHints?: ('prose' | 'slides' | 'conversation' | 'highlight')[];
  /** Free-form source-supplied context: show notes, abstract, thread subject. */
  sourceSummary?: string;
}

// raw-source.ts — Acquire output (handles + metadata, not text).
export interface RawSource {
  canonicalId: string;          // e.g. "web:https://example.com/a"
  /** Additional deterministic identities used by the dedup resolver before insert. */
  dedupKeys?: string[];         // e.g. RSS guid, web canonical URL, DOI, content hash
  sourceType: SourceTypeName;   // extended reconditum SourceType
  sensitivity: 'public' | 'personal' | 'confidential';
  provenance: ProvenanceInput;  // sourceUri, ingestedAt, pipelineVersion, sourceType
  /** Opaque payload the decode chain understands (file path, html, api rows…). */
  payload: unknown;
  /** Human-readable Resource label. */
  label: string;
}
```

`SourceTypeName` is the extended `reconditum` `SourceType` (Section 4.2).

### 3.5 Pipeline Interfaces vs Acquisition Strategies (Layering Rule)

A common misreading — flagged for reviewers — is to treat `ITranscriber`,
`IDiarizer`, `IWebFetcher` as peers of the pipeline interfaces. They are **not**.

| Layer | Interfaces | Role |
| ----- | ---------- | ---- |
| **Pipeline (spine)** | `IIngestor`, `IChunker`, `ICandidateMiner`, `IEditor`, `IExporter` | The fixed `chunk → mine → edit → claim → export` backbone, identical for every vector. |
| **Acquisition helpers** | `IWebFetcher`, feed parser, file-byte reader, API clients | Used by `IIngestor.acquire()` to retrieve raw payloads and source metadata. They do not produce `MediaSegment[]`. |
| **Decode strategies** | `IDecodeStrategy` and its implementations `ITranscriber`, `IDiarizer`, OCR, text-extract, passthrough | Injected *into a vector's decode chain*. They produce `MediaSegment[]`; they are not pipeline stages. |

A web `IIngestor` may use `IWebFetcher` to retrieve canonical HTML; `text-extract`
then decodes that HTML into `MediaSegment[]`. A voice vector uses `ITranscriber` as
its decode strategy. This distinction matters: fetching is provenance-bearing
acquisition, while transcription/OCR/text extraction is modality processing.

### 3.6 Package Architecture

```text
packages/praecis/
├── core/                         @aidha/praecis-core
│   ├── src/types/                Locator, MediaSegment, ExtractionContext, RawSource
│   ├── src/interfaces/           IIngestor, IChunker, ICandidateMiner, IEditor,
│   │                             IExporter, IDecodeStrategy, IContextProvider
│   ├── src/pipeline/             Source-agnostic orchestrator (from youtube/)
│   ├── src/chunk/                Chunkers: time-window, token, section
│   ├── src/extract/              Two-pass miner + editor (from youtube/extract)
│   ├── src/export/               Locator-aware dossier/JSON-LD exporter + deep-links
│   └── src/compose/              composeVector(): wires the four axes + registration
├── acquire/
│   ├── webfetch/                 @aidha/acquire-webfetch (IWebFetcher + backends)
│   └── feed/                     @aidha/acquire-feed     (RSS/podcast feed helpers)
├── decode/
│   ├── text/                     @aidha/decode-text   (readability, pdf-to-text, email render)
│   ├── transcribe/               @aidha/decode-transcribe (ITranscriber + backends)
│   ├── diarize/                  @aidha/decode-diarize (IDiarizer + backends)
│   └── ocr/                      @aidha/decode-ocr    (Tesseract fallback)
└── sources/
    ├── youtube/  (refactored from packages/praecis/youtube)
    ├── web/   pdf/   feeds/   voice/   meetings/   readwise/   email/   linkedin/
```

Dependency rule (enforced by package boundaries): `sources/* → {acquire/*,
decode/*, core}`; `acquire/*` and `decode/*` may import `core` types/interfaces;
`core → {reconditum, phyla, config}`; no `core → acquire/decode/sources` edges; no
`source → source` edges. Source-specific code (email reply-stripping, web
canonicalisation, PDF slide heuristic) lives in its `sources/*` adapter unless it is
genuinely reusable across sources.

> **Note on the existing `packages/praecis/youtube` path.** Phase 0 refactors it to
> implement the `core` interfaces and register via `SourceRegistration`. Whether it
> physically moves to `packages/praecis/sources/youtube` or stays in place is a
> mechanical decision recorded in Phase 0; the import surface (`@aidha/praecis-youtube`)
> is preserved either way.

---

## 4. Core Schema Changes (`reconditum`)

Because there are no persisted graphs (pre-alpha), these are **clean breaks with no
migration**. Existing YouTube fixtures are **regenerated to the new shape** — since
`Excerpt` gains a typed `locator` field, the JSON-LD export shape changes, so
pre/post-refactor byte identity is neither possible nor required. The Phase 0
regression gate is therefore a **semantic-equivalence** check: claim text,
provenance, and deep-link targets must be equivalent pre/post-refactor (same claims,
same sources, same timecodes), and exports must be byte-stable *across runs on the
regenerated fixtures* (Section 7.5).

### 4.1 Locator (new)

Add `Locator` (Section 3.4) to `packages/reconditum/src/schema/`. `Excerpt` nodes
gain a typed locator contract (replacing ad-hoc timestamp keys in `metadata`).
Because `GraphNode` is currently a generic store envelope with `metadata:
z.record(...)`, Phase 0 must add a **typed domain validation surface** rather than
merely documenting new metadata keys:

- `ResourceMetadataSchema` with `canonicalId`, `sourceType`, `provenances`,
  `dedupKeys`, and source labels.
- `ExcerptMetadataSchema` with `resourceId`, `locator: Locator`, `sequence`, and
  optional `speaker`/`section`.
- `ClaimMetadataSchema` and `ReferenceMetadataSchema` updates where export/review
  code reads locator or provenance context.

The storage envelope may remain `GraphNode` for compatibility inside
`GraphStore`, but all upsert/export paths must validate the type-specific metadata
schema before persisting or rendering. YouTube excerpts use `{ kind: 'timecode',
startSec, endSec }`.

### 4.2 SourceType extension

Extend the enum in `packages/reconditum/src/schema/knowledge.ts:15-22` to:

```ts
export const SourceType = z.enum([
  'youtube', 'web', 'pdf', 'document', 'rss', 'podcast',
  'voice', 'meeting', 'readwise', 'email', 'linkedin',
  'article', 'book', 'note', 'import', 'generated',
]);
```

(`article`/`book`/`note`/`import`/`generated` retained for non-vector knowledge.)

### 4.3 Multi-provenance + dedup-and-link

`Provenance` (`knowledge.ts:29-43`) currently sits as a single optional object on
`KnowledgeMetadata`. Change so a `Resource` can carry **multiple** provenances:

- Represent each provenance as a `Provenance` value in an array
  (`provenances: Provenance[]`), **or** as discrete `Provenance` nodes linked by a
  `hasProvenance` edge. Decision recorded in Phase 0 ADR (see Open Question Q1);
  default recommendation: array on the Resource for query simplicity, with a
  `corroboratedBy` edge between Resources when two *distinct* canonical resources
  are later judged equivalent.
- Extend `packages/reconditum/src/schema/edge.ts` `Predicate` with the new
  relationship semantics this plan uses:
  - `alsoSeenVia` — same canonical Resource observed through another vector or
    provenance context.
  - `corroboratedBy` — distinct canonical Resources judged equivalent or strongly
    related without being merged.
  - `hasProvenance` — only if Phase 0 chooses provenance nodes instead of the
    default `provenances: Provenance[]` array.
- Dedup behaviour (Section 7.2): when a vector produces a `canonicalId` that already
  exists, **append** the new `Provenance` to the existing Resource and add an
  `alsoSeenVia` edge from the new provenance context; **never** create a duplicate
  Resource and **never** drop the new provenance.

### 4.4 Locator-aware export / deep-links

`packages/praecis/youtube/src/export/types.ts:5-8` hardcodes `timestampSeconds`,
`timestampLabel`, `timestampUrl`. Replace with a Locator-aware contract in
`core/src/export/`: each `Locator.kind` provides a `renderDeepLink(resource,
locator)` and a `renderLabel(locator)`:

| kind | deep-link | label |
| ---- | --------- | ----- |
| timecode | `https://youtu.be/<id>?t=<startSec>` (or `file://…#t=<startSec>`) | `MM:SS` |
| page | `file://<path>#page=<n>` | `p.<n>` |
| dom | `<url>#:~:text=<fragment>` (text-fragment) | section snippet |
| message | `<thread-anchor>#<messageId>` | sender/date |
| text | source URL if known, else none (no in-content anchor) | snippet |
| external | system-specific (e.g. Readwise URL) | source name |

Determinism: deep-link rendering is pure and fixture-tested per kind.

---

## 5. Composition Framework & Interface Contracts

Defined in `packages/praecis/core/src/interfaces/`.

```ts
// IIngestor — Acquire axis.
export interface IIngestor<TPayload = unknown> {
  readonly sourceId: string;            // matches SourceRegistration.sourceId
  /** Acquire raw input + identity; no decoding here. */
  acquire(input: IngestInput): Promise<Result<RawSource & { payload: TPayload }>>;
}

// DecodeInput — what flows INTO a decode strategy. This is the type that makes
// the decode CHAIN work: the first strategy sees the RawSource; every downstream
// strategy sees the segments produced so far. Both always carry the shared context
// so a strategy can read source metadata (e.g. diarize needs the audio handle that
// transcribe also used).
export interface DecodeInput {
  readonly raw: RawSource;              // always present: identity, payload, sourceType
  /** undefined for the first strategy in the chain; the upstream output otherwise. */
  readonly upstream?: readonly MediaSegment[];
  readonly config: ResolvedConfig;     // backend selection, budgets
}

// IDecodeStrategy — Decode axis. Composable, ordered. The pipeline folds the chain:
//   segments = chain.reduce(acc => strategy.decode({ raw, upstream: acc, config }))
export interface IDecodeStrategy {
  readonly name: string;                // 'text-extract' | 'transcribe' | 'diarize' | 'ocr' | 'passthrough'
  decode(input: DecodeInput): Promise<Result<MediaSegment[]>>;
}

// IChunker — shared spine stage, selected by vector policy/context hints.
export interface IChunker {
  readonly name: string;                // 'token-window' | 'section' | 'conversation' | 'highlight'
  chunk(input: ChunkInput): Promise<Result<Chunk[]>>;
}

// ITranscriber — a decode strategy specialisation (audio → timecoded segments).
export interface ITranscriber {
  readonly backend: string;             // 'openai' | 'groq' | 'assemblyai' | 'voxtral' | 'nvidia' | 'qwen' | 'local'
  transcribe(audio: AudioRef, opts: TranscribeOptions): Promise<Result<TimecodedSegment[]>>;
}

// IDiarizer — annotates timecoded segments with speaker labels.
export interface IDiarizer {
  readonly backend: string;             // 'pyannote' | 'whisperx' | 'assemblyai' | 'none'
  diarize(audio: AudioRef, segments: TimecodedSegment[]): Promise<Result<TimecodedSegment[]>>;
}

// ITranscriber/IDiarizer are NOT IDecodeStrategy — their signatures are
// domain-shaped (audio in, timecoded segments in/out). Thin ADAPTERS in
// decode/transcribe and decode/diarize bridge them to the chain contract. This is
// the seam the four-axis model hangs on, so it is spelled out rather than implied:
export const transcribeStrategy = (t: ITranscriber): IDecodeStrategy => ({
  name: 'transcribe',
  async decode({ raw, config }) {                // first in chain: reads raw audio
    const audio = audioRefFromPayload(raw.payload);
    const segs = await t.transcribe(audio, transcribeOptsFrom(config));
    return mapResult(segs, timecodedToMediaSegments);   // → MediaSegment[] (timecode locator)
  },
});
export const diarizeStrategy = (d: IDiarizer): IDecodeStrategy => ({
  name: 'diarize',
  async decode({ raw, upstream }) {              // downstream: annotates upstream segments
    if (!upstream) return err('diarize requires upstream transcribe output');
    const audio = audioRefFromPayload(raw.payload);
    const annotated = await d.diarize(audio, mediaSegmentsToTimecoded(upstream));
    return mapResult(annotated, timecodedToMediaSegments); // adds `label` (speaker)
  },
});
// text-extract / ocr / passthrough implement IDecodeStrategy directly (no adapter):
// they read raw.payload (html/pdf bytes/api rows) and emit MediaSegment[] with the
// vector's locator kind.

// IWebFetcher — acquisition helper, not a decode strategy.
export interface IWebFetcher {
  readonly backend: string;             // 'readability' | 'playwright'
  fetch(input: WebFetchInput): Promise<Result<{ url: string; canonicalUrl: string; title: string; html: string }>>;
}

// IContextProvider — Contextualize axis.
export interface IContextProvider {
  build(raw: RawSource, userConfig: ResolvedConfig): Promise<ExtractionContext>;
}

// composeVector — wires the four axes into a runnable vector + SourceRegistration.
export function composeVector(spec: VectorSpec): ComposedVector;

export interface VectorSpec {
  sourceId: string;
  sensitivity: 'public' | 'personal' | 'confidential';
  ingestor: IIngestor;
  decode: IDecodeStrategy[];            // ordered chain
  context: IContextProvider;
  chunking: IChunker | 'token-window' | 'section' | 'conversation' | 'highlight';
  registration: SourceRegistration;     // from @aidha/config (AIDHA-PLAN-005)
}

// ComposedVector — the validated, runnable result the pipeline consumes.
export interface ComposedVector {
  readonly sourceId: string;
  readonly sensitivity: VectorSpec['sensitivity'];
  readonly ingestor: IIngestor;
  /** Frozen, validated decode chain. */
  readonly decode: readonly IDecodeStrategy[];
  readonly context: IContextProvider;
  readonly chunking: IChunker;
  readonly registration: SourceRegistration;
  /** Convenience: resolve raw input → MediaSegment[] by running ingestor + decode chain. */
  ingestAndDecode(input: IngestInput): Promise<Result<{ raw: RawSource; segments: MediaSegment[] }>>;
}

// ── The run half ────────────────────────────────────────────────────────────
// A ComposedVector is only the source-specific half. The cross-cutting services
// (LLM, cache, cost ceiling, store, sensitivity policy) are NOT in VectorSpec —
// they are shared across all vectors and injected once when the runtime is built.
// This is the assembly an engineer wires in `main`/CLI; without it Section 5 would
// specify the vector but not how a vector actually runs.
export interface PipelineServices {
  readonly store: GraphStore;           // reconditum; also backs the DedupResolver
  readonly miner: ICandidateMiner;      // holds the LLM client (see below)
  readonly editor: IEditor;
  readonly exporter: IExporter;
  readonly llm: ILLMClient;             // sensitivity policy is applied around this
  readonly cache: ICache;               // content-hash keyed (Section 7.5)
  readonly costCeiling: CostCeiling;    // tokens + spend per run (Section 7.3)
  readonly privacy: PrivacyPolicy;      // per-tier cloud allowance (Section 7.1)
}

export interface PipelineRuntime {
  /** Register a composed vector by sourceId; throws on duplicate/invalid registration. */
  register(vector: ComposedVector): void;
  /** Run one vector end-to-end against an input, honouring cache/cost/sensitivity. */
  run(sourceId: string, input: IngestInput): Promise<Result<RunReport>>;
}

export function createPipelineRuntime(services: PipelineServices): PipelineRuntime;
```

The shared pipeline (`core/src/pipeline/`) consumes a `ComposedVector` and runs:
`acquire → decode(chain) → contextualize → chunk → mine → edit → persist claims →
export`, with idempotency keyed on `canonicalId` and caching keyed on content hashes
(Section 7.5). `chunking` is explicit because several vectors need different
policies (Readwise highlights should not be re-windowed; slide PDFs need section-ish
chunks; meetings need conversation-aware speaker turns).

---

## 6. Per-Vector Specifications

Each vector is specified with: source ID, canonical ID rule, locator kind,
sensitivity, acquire/decode/context composition, anticipated gotchas with
mitigations, and its test inventory. Order follows the execution phases (Section 8).

### 6.1 Web (`web`) — Phase 1

- **Canonical ID:** `web:<canonicalUrl>` where `canonicalUrl` is computed by the
  **shared string-level `urlCanonical()`** (Section 7.2): lower-case host, resolve
  the redirect chain, strip tracking params (`utm_*`, `fbclid`, etc.), normalise
  trailing slash. This is **fetch-independent** so `rss` and `readwise` derive the
  *same* primary ID from a bare URL. A `<link rel="canonical">` discovered *after*
  fetch is recorded as an additional `dedupKey` (`web:<relCanonicalUrl>`), **not**
  promoted to the primary ID — otherwise the same article would canonicalise
  differently depending on whether the arriving vector fetched the page (Section 7.2,
  Open Question Q6).
- **Locator:** `dom`. **Sensitivity:** `personal`.
- **Acquire:** CLI `--url`; `IWebFetcher` (readability default; Playwright backend
  for JS-heavy pages, opt-in via config). Architected to also accept a *pre-fetched*
  DOM/HTML payload (future extension passes the body directly — same decode path).
- **Decode:** `[text-extract]` (readability → main-content text + char offsets).
- **Context:** medium (page title, meta description, site name).
- **Gotchas → mitigations:**
  - *JS-rendered pages* → Playwright backend behind a config flag; readability is
    default to keep the dependency optional.
  - *Paywalls / login walls* → detect (very short body, known login markers) and
    fail gracefully with a clear message; do not store a stub Resource.
  - *Canonical-URL drift* → the redirect chain is resolved inside the shared
    `urlCanonical()` so the primary ID is stable across vectors; `rel=canonical` adds
    a `dedupKey` that lets a *fetched* duplicate merge with a *string-only* arrival
    (Section 7.2). The primary ID never depends on having fetched the page.
- **Tests:** `sources/web/tests/canonicalize.test.ts`, `fetch-readability.test.ts`
  (mocked HTTP), `paywall-detection.test.ts`, `web-pipeline.test.ts` (fixture HTML
  → claims), `locator-deeplink.test.ts` (text-fragment).

### 6.2 PDF & Documents (`pdf`) — Phase 1

- **Canonical ID:** `pdf:sha256(file-bytes)`. **Locator:** `page`.
  **Sensitivity:** `personal`.
- **Acquire:** CLI `--file`; reads bytes, hashes, extracts embedded metadata
  (title, author, DOI, BibTeX where present).
- **Decode:** `[text-extract]` (per-page text + char offsets via `pdf-parse`/
  `pdfjs`); **fallback `[ocr]`** when a page yields no text layer (scanned PDF).
- **Context:** medium (title, abstract if detectable, DOI; slide-vs-paper heuristic
  sets `domainHints`).
- **Gotchas → mitigations:**
  - *Scanned / image-only PDFs* → OCR fallback (`decode/ocr`, Tesseract) triggered
    per-page when no text layer; if OCR unavailable, fail that page gracefully and
    record a warning rather than emitting empty excerpts.
  - *Slide decks vs prose papers* → heuristic (chars/page, bullet density) selects
    chunking strategy (section vs token window) and sets context hints.
  - *Multi-column / tables* → reading-order normalisation in `decode/text`;
    documented as best-effort with a known-limitation note.
  - *EPUB* → handled as a `document` sub-format (spine items as "pages").
- **Tests:** `sources/pdf/tests/hash-id.test.ts`, `extract-text.test.ts` (fixture
  PDF), `ocr-fallback.test.ts` (mocked OCR), `slide-vs-paper.test.ts`,
  `pdf-pipeline.test.ts`, `locator-deeplink.test.ts` (page anchor).

### 6.3 RSS Articles (`rss`) — Phase 1

- **Canonical ID:** `web:<canonicalUrl>` whenever the feed item carries an article
  URL, computed by the **same fetch-independent `urlCanonical()`** the `web` and
  `readwise` vectors use (Section 7.2); otherwise `rss:<feedUrl>#<item-guid>` (or a
  stable hash of feed URL + title + published date when no guid exists). Because
  `urlCanonical()` is string-level, RSS derives the primary `web:` ID *without*
  fetching, so it lands on the identical ID a fetched `web` arrival would — that is
  what makes the merge reliable rather than dependent on `rel=canonical` agreeing
  with the request URL. The feed guid is retained as a `dedupKey`/provenance external
  ID, not preferred over the article work identity. **Locator:** `dom`.
  **Sensitivity:** `public`.
- **Acquire:** CLI `--feed <url>` (and `--item <guid>`); parse feed, select items;
  fetch full article body via `IWebFetcher` when the feed carries only summaries.
- **Decode:** `[text-extract]` (reuses web text-extract).
- **Context:** medium (feed title, item categories).
- **Gotchas → mitigations:**
  - *Summary-only feeds* → fetch full text via webfetch (shared with web vector).
  - *Re-published items (changed guid, same canonical URL)* → same `web:` canonical
    ID merges; the changed guid remains an added dedup/provenance key.
  - *Feed already covered by web/Readwise* → shared `web:` canonical ID dedups.
  - *No article URL / bad canonical URL* → fall back to namespaced RSS identity and
    use content hash only as a corroboration signal, not an automatic merge key.
- **Tests:** `sources/feeds/tests/rss-parse.test.ts`, `rss-item-id.test.ts`,
  `rss-fulltext-fetch.test.ts` (mocked), `rss-pipeline.test.ts`.

### 6.4 Voice Notes (`voice`) — Phase 2

- **Canonical ID:** `voice:sha256(audio-bytes)`. **Locator:** `timecode`.
  **Sensitivity:** `personal`.
- **Acquire:** CLI `--file` (and a documented watch-directory mode as a thin loop
  over the same command — no daemon in v1). Supported formats: wav/mp3/m4a/ogg.
- **Decode:** `[transcribe]` via `ITranscriber` (backend from config). Optional VAD
  silence-trim pre-step inside the transcribe strategy.
- **Context:** thin (optional `--tag`/`--project` → `relatedProjectIds`,
  `topicsOfInterest`).
- **Gotchas → mitigations:**
  - *No local GPU (Windows laptop)* → default to a cloud backend (Groq/OpenAI/
    AssemblyAI) per config; local whisper.cpp is opt-in only.
  - *Long recordings* → transcriber chunks audio; segments stitched with continuous
    timecodes.
  - *Format variety* → ffmpeg normalisation step (documented dependency) before
    transcription.
- **Tests:** `decode/transcribe/tests/{openai,groq,assemblyai,local}.test.ts`
  (mocked clients), `sources/voice/tests/hash-id.test.ts`,
  `voice-pipeline.test.ts` (mock transcriber → claims), `vad-trim.test.ts`.

### 6.5 Meetings (`meeting`) — Phase 2

- **Canonical ID:** `meeting:sha256(audio-bytes)`. **Locator:** `timecode` with
  `speaker`. **Sensitivity:** `confidential`.
- **Acquire:** CLI `--file` (recording); optional `--calendar-event <id>` to attach
  context in a later phase (Calendar is roadmap — accept the id as opaque now).
- **Decode:** `[transcribe, diarize]` — transcribe, then `IDiarizer` annotates each
  timecoded segment with a `speaker` label.
- **Context:** rich (meeting title, attendee names where provided via CLI →
  speaker-label hints).
- **Gotchas → mitigations:**
  - *Diarisation backend choice* → `IDiarizer` with backends `pyannote` /
    `whisperx` / `assemblyai` (native, when the transcriber already diarises) /
    `none`. Default documented; AssemblyAI native diarisation avoids a second tool.
  - *Speaker-label continuity across sessions* → v1 labels are per-recording
    (`Speaker 1..N`); cross-session identity resolution is an explicit Open Question
    (Q4), not built now.
  - *Confidential content to cloud* → sensitivity gate (Section 7.1) can force a
    local LLM / local transcriber, or block the run with a clear error.
- **Tests:** `decode/diarize/tests/{pyannote,whisperx,assemblyai,none}.test.ts`
  (mocked), `sources/meetings/tests/meeting-pipeline.test.ts` (mock transcribe+
  diarize → speaker-labelled claims), `speaker-locator.test.ts`,
  `sensitivity-gate.test.ts`.

### 6.6 Podcasts (`podcast`) — Phase 2

- **Canonical ID:** `podcast:<enclosureUrl>` (fallback
  `podcast:sha256(audio-bytes)`). **Locator:** `timecode` (+ `speaker` for panels).
  **Sensitivity:** `public`.
- **Acquire:** CLI `--feed <url> --episode <guid>`; parse podcast feed, download the
  audio enclosure, discover show-notes URL.
- **Decode:** `[transcribe]` (mono) or `[transcribe, diarize]` (panel) — reuses the
  Phase 2 transcribe/diarize strategies wholesale.
- **Context:** rich (episode title, show notes, description → `sourceSummary`).
- **Gotchas → mitigations:**
  - *Very long episodes (2–3h)* → transcriber chunking + token-budgeted mining;
    cost ceiling enforced (Section 7.3).
  - *Episodes re-published* → enclosure-URL + content-hash dedup-and-link.
  - *Show-notes discovery* → parse `<itunes:summary>`/`<content:encoded>`; degrade
    gracefully when absent.
- **Tests:** `sources/feeds/tests/podcast-parse.test.ts`,
  `podcast-enclosure-id.test.ts`, `podcast-pipeline.test.ts` (mock fetch+transcribe).

### 6.7 Readwise (`readwise`) — Phase 3

- **Canonical ID:** the parent Resource's identity belongs to the **underlying
  work**, not the arrival vector: when the Readwise export item carries a
  `source_url`, the parent canonical ID is `web:<canonicalUrl>` derived by the
  **same fetch-independent `urlCanonical()` the `web`/`rss` vectors use**
  (Sections 6.1, 6.3, 7.2). Readwise does **not** fetch the page, so it relies on the
  string-level primary ID — which is exactly why `urlCanonical()` must not depend on
  `rel=canonical`. When no `source_url` is present (manual highlights, some tweets),
  it falls back to `readwise:book:<bookId>`. Deriving the same `web:<canonicalUrl>`
  is what lets the same article seen via RSS and via Readwise dedup-and-link to one
  Resource (Section 7.2).
  Highlights are addressed by `external` locators (`system: 'readwise'`,
  `externalId: <highlightId>`); re-runs stay idempotent on `<highlightId>`.
  (This parent-ID scheme deliberately differs from its siblings — Readwise is a
  re-publication layer over works that have their own identity.) **Locator:**
  `external` (`system: 'readwise'`). **Sensitivity:** `personal`.
- **Acquire:** Readwise REST API (`/export` with `updated_after` for incremental
  sync); token via `${READWISE_TOKEN}` config interpolation. The parent "book"
  (article/book/podcast/tweet source) becomes a Resource; each highlight becomes a
  pre-segmented `MediaSegment`. Each parent also carries `readwise:book:<bookId>`
  as a `dedupKey` so Readwise re-runs remain stable even when the underlying
  canonical work is a `web:` Resource.
- **Decode:** `[passthrough]` — highlights are already curated text spans; no
  chunking needed (each highlight is its own excerpt). They still flow through
  mine → edit → claim, but mining treats each highlight as a high-priority candidate
  (it is *pre-curated by the user* — the highest signal-to-noise input).
- **Context:** medium (book title, author, source category → `domainHints`).
- **Gotchas → mitigations:**
  - *Incremental sync / idempotency* → persist last `updated_after` cursor; re-runs
    are idempotent on `highlightId`; edited highlights update the existing excerpt.
  - *Cross-vector overlap* (a Kindle book also a PDF) → dedup-and-link on a shared
    work identifier where derivable; otherwise distinct Resources linked by
    `corroboratedBy`.
  - *Rate limits* → backoff + cursor checkpointing so a partial run resumes.
- **Tests:** `sources/readwise/tests/export-pagination.test.ts` (mocked API),
  `incremental-cursor.test.ts`, `highlight-passthrough.test.ts`,
  `readwise-pipeline.test.ts`.

### 6.8 Email — file import (`email`) — Phase 3

- **Canonical ID:** `email:thread:<rootMessageId>` — the **thread** is the Resource
  unit; each message is an excerpt with a `message` locator carrying its own
  `messageId`. `rootMessageId` is derived deterministically: the first entry of the
  `References` header, else `In-Reply-To`, else the message's own `Message-ID`.
  Because `In-Reply-To` may point to an immediate parent rather than the true root,
  Phase 3 must implement `ThreadIdentityResolver`: if a later import reveals an
  earlier root, it reparents/aliases the provisional `email:thread:<inReplyTo>`
  Resource to `email:thread:<trueRootMessageId>` and moves/merges excerpts and
  provenances atomically. Without that reparenting test, the plan must not claim
  import-order-independent email deduplication.
  **Locator:** `message` (`messageId` per excerpt). **Sensitivity:** `confidential`.
- **Acquire:** CLI `--file` (and a folder of them). Parse headers
  (from/to/subject/date/Message-ID/References) to reconstruct the thread.
  **`.eml` (MIME text) is the v1 target**, parsed with `mailparser`. **`.msg`** is
  Microsoft's binary CFB format requiring a dedicated parser (`@kenjiuno/msgreader`)
  and is reliably brittle; it is a **Phase 3 stretch**, shipped only if the `.eml`
  path is solid and time permits. The two formats are *not* treated as
  interchangeable.
- **Decode:** `[text-extract]` with an email-specific **reply-strip** preprocessor:
  HTML→text rendering, quoted-reply and signature stripping, so an N-reply thread
  does not produce N× duplicated excerpts.
- **Context:** medium (thread subject, participants → `sourceSummary`).
- **Gotchas → mitigations:**
  - *Quoted-reply duplication* → reply-strip preprocessor (the single most important
    email correctness step); tested against multi-reply fixtures.
  - *HTML email* → sanitised HTML→text; strip tracking pixels.
  - *Attachments* → v1 policy: record attachment metadata as Reference nodes; do
    **not** auto-ingest attachment bodies (a PDF attachment is ingested via the
    `pdf` vector explicitly). Documented.
  - *Thread vs message as Resource* → thread is the Resource; messages are excerpts
    with `message` locators (rationale: claims usually span a conversation).
  - *Confidential to cloud* → sensitivity gate (Section 7.1).
- **Tests:** `sources/email/tests/parse-eml.test.ts`,
  `reply-strip.test.ts` (multi-reply fixture), `thread-reconstruction.test.ts`,
  `thread-reparenting.test.ts` (leaf imported before root), `email-pipeline.test.ts`,
  `sensitivity-gate.test.ts`; `parse-msg.test.ts` only if the `.msg` stretch is
  taken.

### 6.9 LinkedIn — paste bridge (`linkedin`) — Phase 4

- **Canonical ID:** `linkedin:<activityUrn>` when derivable from a pasted URL;
  else `linkedin:sha256(pasted-text)`. **Locator:** `text` (char offsets into the
  pasted body — there is no DOM/source addressing for stdin input).
  **Sensitivity:** `personal`.
- **Acquire:** CLI `--paste` (reads stdin/editor) and optional `--url` (stored as
  provenance only; **no fetching** — LinkedIn blocks unauthenticated/headless
  access, documented explicitly). This is the honest v1 capture: prove the pipeline
  on pasted post text; full capture awaits the browser extension (Non-Goal).
- **Decode:** `[passthrough]` (pasted text → single/segmented excerpts).
- **Context:** thin (optional author/url metadata).
- **Gotchas → mitigations:**
  - *No API / scraping blocked* → paste bridge only; the plan states this as a
    constraint, not a defect. Extension capture is AIDHA-PLAN-008.
  - *Dedup if later re-captured via extension* → `activityUrn` canonical ID makes
    the future extension capture dedup-and-link to the paste-bridge Resource.
- **Tests:** `sources/linkedin/tests/paste-id.test.ts`,
  `linkedin-pipeline.test.ts`.

---

## 7. Cross-Cutting Concerns

### 7.1 Sensitivity & Privacy

Every vector declares `sensitivity: public | personal | confidential` in its
`VectorSpec`. The shared LLM client (used by the candidate miner) honours a
per-tier policy resolved from config:

```yaml
privacy:
  public:       { allow_cloud_llm: true }
  personal:     { allow_cloud_llm: true }
  confidential: { allow_cloud_llm: false, require_local_llm: true }
```

When a run's vector sensitivity exceeds the configured cloud allowance, the pipeline
either routes to a configured local model or **fails fast with a clear error** —
never silently sends confidential content (meeting transcripts, private email) to a
cloud API. This is enforced in `core` before any miner call. **Routing is evaluated
per Resource against the active vector's `sensitivity`** (not per batch), so a run
mixing personal voice notes with confidential meetings routes each Resource
correctly rather than failing or downgrading the whole batch. Tested per confidential
vector (`sensitivity-gate.test.ts`).

### 7.2 Canonicalization & Dedup-and-Link

- **Stable IDs** per vector (Section 6) make idempotency deterministic.
- **Two-tier URL canonicalisation (the linchpin of cross-vector merge).** A single
  shared helper `urlCanonical(rawUrl: string): string` lives in `core` and is the
  **only** thing that computes a `web:` *primary* ID. It is deliberately
  **fetch-independent** — it operates on a URL string alone:
  1. lower-case scheme + host, drop default ports and fragments;
  2. resolve a bounded redirect chain (HEAD-only, optional; skipped offline);
  3. strip tracking params (`utm_*`, `fbclid`, `gclid`, `ref`, …) and sort the
     remaining query;
  4. normalise the trailing slash.

  Every vector that knows a URL — `web`, `rss`, `readwise` — derives its primary
  `web:<canonicalUrl>` through this same helper, so the *same article yields the same
  ID regardless of which vector arrives first and whether it fetched the page*.
  `<link rel="canonical">` is **content** (only available after a fetch), so it is
  **never** part of the primary ID; a fetching vector (`web`) records the discovered
  `web:<relCanonicalUrl>` as an additional **`dedupKey`**. This lets a later
  string-only arrival (RSS/Readwise) whose URL equals the discovered canonical merge
  in, without making the primary ID fetch-dependent. (Whether the redirect-resolution
  step in (2) is on by default is Open Question Q6.)
- **Dedup keys:** every `RawSource` may carry `dedupKeys` in addition to its primary
  `canonicalId`. Keys are namespaced (`web:`, `rss:`, `readwise:book:`, `doi:`,
  `content-sha256:`) and ranked by confidence. Strong identity keys (`web:`, `doi:`,
  exact email thread root) may merge. Weak keys (`content-sha256:` for short text,
  title/date) may only create `corroboratedBy` links unless a vector-specific test
  proves safe merging.
- **Dedup-and-link:** when an incoming `canonicalId` or strong `dedupKey` matches an
  existing Resource, AIDHA appends the new `Provenance` and adds an `alsoSeenVia`
  edge — it does **not** create a duplicate and does **not** discard the arrival. The
  same article via RSS *and* Readwise becomes one Resource with two provenances
  **because both run `urlCanonical()` over the same article URL** — RSS from the feed
  item link (Section 6.3) and Readwise from `source_url` (Section 6.7) — yielding the
  identical primary ID without either needing to fetch. When no shared strong identity
  is derivable (e.g. a Readwise highlight with no `source_url`), the two stay distinct
  Resources linked by `corroboratedBy` rather than merging.
- **Cross-canonical corroboration:** when two *distinct* canonical Resources are
  later judged to represent the same work (e.g. a PDF and its Readwise highlights),
  a `corroboratedBy` edge links them; their excerpts/claims remain queryable
  together. (Automatic equivalence detection beyond shared identifiers is an Open
  Question, Q3 — v1 links only on derivable shared identifiers.)

### 7.3 Cost Controls

Reuse the existing pipeline cost ceilings (AIDHA-STRATEGY-002 §9.4): max tokens and
max spend per run, enforced in `core` before/within mining. Transcription cost is
added to the budget for audio vectors; long-podcast runs respect a configurable
ceiling and surface estimated cost before proceeding. Caching (7.5) prevents paying
twice for re-runs.

### 7.4 Config & SourceRegistration Integration

Each vector ships a `SourceRegistration` (AIDHA-PLAN-005 contract) declaring:
`sourceId`, source-default config, path/secret/scalar metadata, the active-source
config validator, redaction, path resolution, and CLI bindings. New config sections
appear under `sources.<id>` and `profiles.*.source_overrides.<id>` per PLAN-005 §4.
Examples: `sources.voice.transcribe.backend`, `sources.readwise.token`,
`sources.web.fetcher`. Secrets (`readwise.token`) use `${VAR}` interpolation and are
redacted by default.

### 7.5 Determinism & Caching

- Every IO boundary (HTTP, model, transcriber, diarizer, OCR, subprocess, clock) is
  an injected interface with a deterministic mock for CI (no-network per PRD-002
  NFR-1).
- Acquisition results and model/transcription responses are cached keyed on content
  hashes (audio bytes, html, prompt+input). First-run *cloud* transcription is not
  deterministic (server-side variability); determinism applies to cache-hit re-runs
  and to CI runs against mocks. Once a response is cached, all downstream output is
  byte-stable and re-runs are free.
- `MediaSegment.id` and node IDs derive deterministically from `(canonicalId,
  locator)` so exports diff cleanly.

### 7.6 Transcription Backend Strategy

`ITranscriber` backends, selected via `sources.<id>.transcribe.backend`:

| Backend | Use | Notes |
| ------- | --- | ----- |
| `openai` | cloud Whisper | simple, consistent |
| `groq` | cloud faster-whisper | fast, low cost |
| `assemblyai` | cloud, native diarisation | doubles as `IDiarizer` |
| `voxtral` | cloud, low WER | Mistral speech model |
| `nvidia` / `qwen` | cloud, newer low-WER | pluggable |
| `local` | whisper.cpp | opt-in; not default (Windows laptop lacks GPU grunt) |

Default backend is cloud; local is opt-in. Backends are isolated modules with a
shared mock for tests.

### 7.7 Diarisation Backend Strategy

`IDiarizer` backends: `assemblyai` (native — preferred when already transcribing
with AssemblyAI, avoids a second tool), `pyannote`, `whisperx`, `none`. Folded into
the decode chain as a strategy *after* `transcribe`, not into `ITranscriber`, so a
vector can transcribe without diarising (voice note) or add diarisation (meeting).

---

## 8. Execution Plan

Each phase produces working, tested, documented software. Phases gate on green
tests + DocOps. TDD throughout: contract test first, mock at IO boundaries.

### Phase 0 — Foundation (gated on SourceRegistration baseline; no new vectors)

**Precondition:** implementation branch includes AIDHA-PLAN-005's
`SourceRegistration` contract and YouTube registration adapter (Baseline Dependency
Gate, Section 1).

- [ ] Record an ADR (`docs/20-adr/adr-009-multi-vector-ingestion-architecture.md`)
      capturing the four-axis composition model, the source-vs-modality split, and
      the multi-provenance decision (array vs nodes — resolve Q1).
- [ ] Revise `AIDHA-PRD-002` (or author a new `AIDHA-PRD-004` "Multi-Vector
      Ingestion") so the product requirements reflect the four-axis architecture and
      the eight vectors, not just YouTube.
- [ ] Create `packages/praecis/core` skeleton (package.json, tsconfig, vitest).
- [ ] Add core types (`Locator`, `MediaSegment`, `ExtractionContext`, `RawSource`)
      with failing schema tests, then implementations.
- [ ] Add `reconditum` schema changes with contract tests: Locator-aware
      type-specific metadata validators, SourceType extension, multi-provenance,
      `dedupKeys`, and new predicates (`alsoSeenVia`, `corroboratedBy`, plus
      `hasProvenance` only if provenance nodes are chosen); regenerate YouTube
      fixtures.
- [ ] Add interfaces (`IIngestor`, `IChunker`, `ICandidateMiner`, `IEditor`,
      `IExporter`, `IDecodeStrategy`, `IContextProvider`) and `composeVector`.
- [ ] Implement the `DedupResolver` contract: strong identity merge vs weak
      corroboration link, with tests for RSS↔web, RSS↔Readwise, PDF↔Readwise, and
      email provisional-thread reparenting.
- [ ] Extract pipeline + chunk + extract + export from `praecis/youtube` into
      `core`; make them Locator-aware (deep-link renderers per kind).
- [ ] Refactor `praecis/youtube` to implement the interfaces, compose via
      `composeVector`, and register via `SourceRegistration`.
- [ ] Verify: all existing YouTube tests pass; dossier/JSON-LD exports are
      **semantically equivalent** to pre-refactor output — same claims, provenance,
      and deep-link targets — and **byte-stable across re-runs on the regenerated
      fixtures** (regression gate; not byte-identical to pre-refactor output, since
      the new `locator` field changes the export shape — Section 4 preamble).

**Acceptance:** `pnpm -C packages/praecis/core test` and
`pnpm -C packages/praecis/youtube test` green; YouTube export **semantically
equivalent** to pre-refactor (same claims/provenance/deep-link targets on
regenerated fixtures — not byte-equal, since the Locator field changes the export
shape); `aidha config explain` works for the `youtube` registration.

### Phase 1 — Text, no auth: Web + PDF + RSS

- [ ] `decode/text` (readability extract; pdf-to-text; shared char-offset model).
- [ ] `acquire/webfetch` (`IWebFetcher`: HTTP/readability default, Playwright opt-in).
- [ ] `decode/ocr` (Tesseract fallback; mockable).
- [ ] `sources/web` — acquire (canonicalise URL), compose `[text-extract]`,
      register, CLI `aidha ingest web --url`.
- [ ] `sources/pdf` — acquire (hash + metadata), compose `[text-extract] ?? [ocr]`,
      slide-vs-paper heuristic, CLI `aidha ingest pdf --file`.
- [ ] `sources/feeds` (rss part) — parse feed, full-text fetch, compose
      `[text-extract]`, CLI `aidha ingest rss --feed`.
- [ ] Dedup-and-link wired (web ↔ rss shared `web:` work identity).

**Acceptance:** each vector ingests a fixture → claims with correct Locators;
deep-links render per kind; dedup-and-link test passes; runbooks added; no-network
CI green.

### Phase 2 — Audio: Voice → Meetings + Podcasts

- [ ] `decode/transcribe` — `ITranscriber` + backends (openai, groq, assemblyai,
      voxtral, nvidia, qwen, local) behind a shared mock; VAD trim.
- [ ] `decode/diarize` — `IDiarizer` + backends (assemblyai, pyannote, whisperx,
      none) behind a shared mock.
- [ ] `sources/voice` — acquire (hash), compose `[transcribe]`, CLI
      `aidha ingest voice --file`.
- [ ] `sources/meetings` — compose `[transcribe, diarize]`, speaker locators, CLI
      `aidha ingest meeting --file`; sensitivity gate enforced.
- [ ] `sources/feeds` (podcast part) — enclosure download + show-notes context,
      compose `[transcribe] | [transcribe, diarize]`, CLI
      `aidha ingest podcast --feed --episode`.

**Acceptance:** mock-transcriber pipelines produce timecoded (and speaker-labelled)
claims; confidential `meeting` run blocked when `allow_cloud_llm:false` and no local
model; cost ceiling honoured; runbooks added.

### Phase 3 — APIs: Readwise + Email file-import

- [ ] `sources/readwise` — REST export with `updated_after` cursor, passthrough
      decode, idempotent on `highlightId`, CLI `aidha ingest readwise --since`.
- [ ] `sources/email` — `.eml` parse (`mailparser`), thread reconstruction,
      reply-strip preprocessor, `message` locators, CLI `aidha ingest email --file`;
      sensitivity gate. (`.msg` via `@kenjiuno/msgreader` is a stretch — Section 6.8.)

**Acceptance:** Readwise incremental re-run is idempotent and links cross-vector
overlaps; out-of-order email thread imports reparent/merge correctly; multi-reply
email fixture produces de-duplicated excerpts; attachments recorded as References,
not auto-ingested; runbooks added.

### Phase 4 — LinkedIn paste bridge

- [ ] `sources/linkedin` — `--paste` (stdin/editor) + `--url` (provenance only,
      no fetch), passthrough decode, CLI `aidha ingest linkedin --paste`.

**Acceptance:** pasted post → claims; canonical `activityUrn` ID set when URL given
(future extension dedup-ready); runbook notes the no-fetch constraint.

### Phase 5 — Deferred (AIDHA-PLAN-008)

Browser/Edge extension + local receiver, OS share targets, tab-group capture,
Email Graph API tag-triggered sync, direct-multimodal miner (consume `mediaRef`).
Out of scope here; seams are in place.

---

## 9. Verification Plan

### Per-package test suites (CI-enforced, offline)

| Package | Key tests |
| ------- | --------- |
| `praecis/core` | `locator.test.ts`, `media-segment.test.ts`, `compose-vector.test.ts`, `chunking-policy.test.ts`, `pipeline.test.ts`, `export-deeplink.test.ts` (all six locator kinds), `dedup-link.test.ts`, `dedup-weak-key.test.ts`, `sensitivity-gate.test.ts`, `determinism.test.ts` |
| `reconditum` | schema contract tests: type-specific metadata validation for Resource/Excerpt/Claim/Reference, extended SourceType, multi-provenance array/edges, `alsoSeenVia`/`corroboratedBy` predicates |
| `decode/text` | readability extract, pdf text + offsets, email render |
| `decode/transcribe` | per-backend mocked clients; VAD trim; chunk-stitch timecodes |
| `decode/diarize` | per-backend mocked; speaker annotation; `none` passthrough |
| `acquire/webfetch` | readability vs playwright selection; canonical URL; mocked HTTP |
| `decode/ocr` | fallback trigger; mocked OCR; graceful failure |
| `sources/*` | per-vector: id rule, pipeline (fixture → claims), gotcha-specific tests (Section 6) |

### Integration / CLI

- `aidha ingest <vector> …` for each vector against fixtures (no network).
- `aidha config explain sources.<id>.…` for each registration.
- Cross-vector dedup-and-link integration test, two cases:
  - **Merge:** an RSS item and a Readwise export item whose `source_url` canonicalises
    to the *same* `web:<canonicalUrl>` → **one Resource, two provenances** (asserts the
    Section 6.7 `source_url`→`web:` derivation lands on the RSS `web:` identity). The
    fixture must use a Readwise item that *carries* `source_url`, and the RSS item
    must have a guid to prove guid does not wrongly outrank the work identity.
  - **Link, not merge:** a Readwise item with no `source_url` → **two Resources joined
    by `corroboratedBy`**, never silently merged.
  - **Email reparent:** import a reply without `References`, then import the true
    root; the provisional thread Resource is aliased/merged into the root thread
    without duplicate excerpts or lost provenance.

### Determinism gate

- Exports are byte-stable across **two runs on identical fixtures** (i.e. cached
  re-runs and CI runs against mocks). First-run *cloud* transcription/diarisation is
  **not** deterministic (server-side variability, even at `temperature: 0`); it
  becomes reproducible only once cached (Section 7.5). The gate asserts byte-stability
  for cache-hit and mock paths, not for first-run network calls.
- YouTube exports are **semantically equivalent** pre/post Phase 0 refactor (same
  claims/provenance/deep-link targets), not byte-identical (the Locator field changes
  the export shape — Section 4 preamble).

### DocOps gate

- Per vector: runbook (`docs/50-runbooks/`) + quickstart update
  (`docs/60-devex/ingest-quickstart.md`); `pnpm docs:build` and DocOps checks green.

### Run commands

```bash
pnpm -C packages/praecis/core test
pnpm -C packages/praecis/decode/text test       # …and each decode/* package
pnpm -C packages/praecis/sources/web test        # …and each sources/* package
pnpm -C packages/reconditum test
node scripts/meminit-check.mjs docs/05-planning/plan-007-other-ingestion-vectors.md
pnpm docs:build
```

---

## 10. Security Considerations

1. **Secrets via interpolation only** — Readwise token, any API keys use `${VAR}`;
   never stored literally; redacted by default (AIDHA-PLAN-005 §9).
2. **Confidential content gating** — Section 7.1; confidential vectors cannot reach
   a cloud LLM unless explicitly permitted.
3. **Subprocess environment allowlists** — transcribers/OCR/yt-dlp subprocesses get
   an explicit env allowlist, not full `process.env` (PLAN-005 §9.11).
4. **Email/file parsing safety** — sanitise HTML; strip tracking pixels; never
   execute embedded content; bound parser resource use.
5. **Local file handling** — refuse symlink traversal surprises for `--file`
   inputs; do not write outside configured `out_dir`.
6. **No silent network in CI** — every network boundary mockable and mocked.

---

## 11. Adversarial Review Resilience

This section pre-empts the issues GPT and Gemini are most likely to raise. The
review gate is not an issue-count target; it is **zero unresolved blockers** plus a
triage note for every substantive finding (fixed now, deferred with owner/date, or
rejected with evidence).

| Anticipated concern | Pre-emptive answer |
| ------------------- | ------------------ |
| "Pipeline interfaces and `ITranscriber` are layered confusingly." | Explicit layering rule (Section 3.5): transcriber/diarizer/fetcher are decode strategies *below* the spine, not pipeline peers. |
| "Excerpt addressing is timestamp-hardcoded; this needs migration." | Locator union (Section 4.1) replaces it; **no migration** — pre-alpha, no persisted graphs (Section 4 preamble). |
| "Sending private email/meetings to OpenAI is unsafe." | Per-vector sensitivity tier + `require_local_llm` gate enforced in core before any miner call (Section 7.1). |
| "Same article via two vectors → duplicate resources." | Dedup-and-link (Section 7.2): merge into canonical, append provenance, add `alsoSeenVia`; never duplicate, never discard. |
| "RSS guid prevents RSS↔Readwise merge." | RSS uses `web:<canonicalUrl>` when an article URL exists; guid is a dedup/provenance key, not the primary work ID (Section 6.3). |
| "`web:` IDs differ across vectors because only `web` fetches `rel=canonical`." | The primary `web:` ID is computed by a single **fetch-independent** `urlCanonical()` shared by web/rss/readwise; `rel=canonical` is a post-fetch `dedupKey`, never the primary ID (Section 7.2, Q6). |
| "`alsoSeenVia`/`corroboratedBy` do not exist in `Predicate`." | Phase 0 explicitly extends `reconditum` edge predicates and tests them before vector work starts (Section 4.3). |
| "`Locator` is just another untyped metadata record." | Phase 0 adds type-specific metadata validators for Resource/Excerpt/Claim/Reference upsert/export paths (Section 4.1). |
| "Scanned PDFs have no text layer." | OCR fallback per page (Section 6.2); graceful failure + warning when OCR unavailable. |
| "Quoted replies will duplicate email excerpts 5×." | Reply-strip preprocessor (Section 6.8), tested against multi-reply fixtures. |
| "Email import order still creates duplicate threads." | `ThreadIdentityResolver` reparents provisional thread IDs when a true root later appears; covered by `thread-reparenting.test.ts` (Section 6.8). |
| "Which diarisation backend, and how do speakers persist?" | `IDiarizer` backends enumerated (7.7); cross-session speaker identity is an explicit Open Question (Q4), not silently assumed. |
| "LinkedIn can't be fetched unauthenticated." | Acknowledged as a constraint; paste bridge only; extension deferred (Section 6.9, Non-Goals). |
| "Readwise re-sync will duplicate / miss edits." | `updated_after` cursor + idempotency on `highlightId` (Section 6.7). |
| "Cost of transcribing long podcasts is unbounded." | Cost ceilings + pre-run estimate + caching (Section 7.3). |
| "Determinism claims are untested across vectors." | Determinism gate + caching keyed on content hashes (Sections 7.5, 9). |
| "`SourceRegistration` isn't available." | Baseline Dependency Gate (Section 1); current worktree has it, and any implementation branch that lacks it must rebase/merge before Phase 0. |
| "Eight vectors is over-scoped." | Phased with gates; Tier-2/3 explicitly roadmap-only (Appendix A); `mediaRef`/extension are seams, not built. |

---

## 12. Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| implementation branch lacks PLAN-005 `SourceRegistration` baseline → Phase 0 blocked | Rebase/merge the current baseline first; do not fork the config contract in this plan. |
| Pipeline extraction from `youtube` breaks behaviour | Semantic-equivalence regression gate on regenerated fixtures (Phase 0 acceptance): same claims/provenance/deep-link targets, byte-stable across re-runs. |
| Transcription quality/cost varies by backend | Pluggable backends + fixtures; default cloud, opt-in local; cost ceilings. |
| Diarisation accuracy on noisy meetings | Backend choice + documented best-effort; per-recording labels only in v1. |
| Web/LinkedIn anti-bot fragility | Web defaults to readability; LinkedIn is paste-only; no scraping committed. |
| Scope creep into extension/Graph API | Hard Non-Goals; deferred to PLAN-008. |
| Decode chain abstraction over-engineered | Plain composed functions + registration record; reviewed against "no DI container" principle (§2.8). |
| Weak dedup keys merge unrelated Resources | Dedup keys are ranked; weak keys create `corroboratedBy` unless vector-specific tests prove safe merge (Section 7.2). |

---

## 13. Open Questions

- **Q1 — Multi-provenance representation:** array on Resource vs discrete
  `Provenance` nodes + edges? *Default:* array for query simplicity, `corroboratedBy`
  edge for cross-canonical links. Resolve in Phase 0 ADR.
- **Q2 — Chunking strategy selection:** is the slide-vs-paper / monologue-vs-panel
  heuristic sufficient, or should chunking be config-overridable per vector? *Lean:*
  heuristic default + per-vector config override.
- **Q3 — Cross-canonical equivalence:** how aggressively should AIDHA auto-link
  distinct canonical Resources judged "the same work"? *v1:* only on derivable shared
  identifiers; semantic equivalence is future (Phase 2 AI maturity, STRATEGY-002 §8).
- **Q4 — Cross-session speaker identity:** should `Speaker 1` in two meetings ever be
  unified into a `Person` node? *v1:* no; per-recording labels only.
- **Q5 — Watch-directory ingestion:** is a thin re-run loop enough for voice notes,
  or is a daemon wanted? *v1:* documented loop, no daemon.
- **Q6 — Redirect resolution in `urlCanonical()`:** should the bounded HEAD redirect
  step (Section 7.2 step 2) be on by default? It improves merge recall (shortened/
  syndicated links collapse to the final URL) but reintroduces a network dependency
  into ID computation, which weakens the "fetch-independent primary ID" guarantee for
  the vectors that rely on it. *Lean:* off by default (pure string canonicalisation);
  redirect-resolved URLs become `dedupKeys`, not the primary ID, mirroring the
  `rel=canonical` treatment. Resolve in Phase 1 when `web`/`rss` land.

---

## 14. Definition of Done

1. All eight vectors (+ LinkedIn paste bridge) ingest fixtures end-to-end to
   reviewed-ready draft claims with correct Locators and deep-links.
2. `praecis/youtube` refactored onto `core`; YouTube exports **semantically
   equivalent** to pre-refactor output (same claims/provenance/deep-link targets)
   and byte-stable across re-runs on the regenerated fixtures — not byte-identical
   to pre-refactor output, since the new `locator` field changes the export shape.
3. Every vector ships **code + tests + DocOps** (runbook + quickstart) in lockstep;
   `pnpm docs:build` and DocOps checks green.
4. No-network CI green across all new packages; determinism gate passes.
5. Dedup-and-link, sensitivity gating, and cost ceilings are tested.
6. Adversarial review (GPT + Gemini) has **zero unresolved blockers**; every
   substantive finding is fixed, explicitly deferred with owner/date, or rejected
   with evidence.

---

## Dependencies

- **AIDHA-PLAN-005 Phase 5A–5E** (`SourceRegistration` contract) — baseline
  prerequisite, present in the current worktree; verify before Phase 0 on any new
  branch (Baseline Dependency Gate, Section 1).
- **AIDHA-PRD-001** (Graph Database) — node/edge contracts, JSON-LD export, multi-provenance.
- **AIDHA-PRD-002** (Ingest to Graph) — pipeline, idempotency, no-network CI.
  **To be revised under this plan:** PRD-002 is YouTube-centric; it must be updated
  (or superseded by a new PRD-004 "Multi-Vector Ingestion") to reflect the four-axis
  architecture and the eight vectors. Tracked as a Phase 0 DocOps task.
- **AIDHA-PRD-003** (Taxonomy) — tag assignment for new Resources.
- **AIDHA-ADR-004** (Ingestion Architecture), **ADR-006** (Claim Lifecycle),
  **ADR-007** (Two-pass Extraction), **ADR-008** (Configuration Management).
- **AIDHA-FDD-001** (Ingestion Engine Design) — concrete pipeline workflow.
- New **ADR-009** (this plan) — multi-vector composition architecture.

---

## Appendix A — Tier-2/3 Vector Roadmap (Not Built Here)

Named, with reuse notes and rough effort, for a future plan:

| Vector | Reuse from this plan | Notes / effort |
| ------ | -------------------- | -------------- |
| **Kindle highlights** | Readwise passthrough; or `My Clippings.txt` parser | Likely subsumed by Readwise; standalone parser is small. |
| **GitHub/GitLab issues & PRs** | text-extract + REST acquire | Excellent APIs; developer-relevant; medium effort. |
| **Calendar (Outlook/Google)** | enrichment, not a primary vector | Feeds meeting `ExtractionContext` (attendees/agenda) + speaker hints; medium. |
| **Slack/Teams** | text-extract + API acquire | High knowledge density **but** tension with single-user ethos (STRATEGY-002 §12) — flag before building. |
| **Twitter/X** | Readwise or extension | API restricted/expensive; prefer capture via Readwise/extension, not standalone. |
| **Obsidian / Markdown vault** | text-extract | Raises complement-vs-compete + bidirectional-sync question (STRATEGY-002 Q9) — design decision first. |
| **Zotero / citation managers** | PDF text-extract + REST/local DB acquire | "Readwise for academic PDFs" with rich citation metadata (DOI, BibTeX, collections); strong fit for the research workflow; medium effort. |
| **Screenshots / diagrams** | `decode/ocr` + future image-multimodal miner | Visual capture via image OCR; aligns with low-friction capture for the ADHD-adjacent profile; depends on the `mediaRef` direct-multimodal seam. |

## Appendix B — Example Config & CLI

```yaml
sources:
  web:      { fetcher: readability }                 # or: playwright
  pdf:      { ocr: { enabled: true, engine: tesseract } }
  voice:    { transcribe: { backend: groq } }
  meeting:  { transcribe: { backend: assemblyai }, diarize: { backend: assemblyai } }
  podcast:  { transcribe: { backend: groq } }
  readwise: { token: ${READWISE_TOKEN} }
privacy:
  confidential: { allow_cloud_llm: false, require_local_llm: true }
```

```bash
aidha ingest web --url https://example.com/article
aidha ingest pdf --file ./paper.pdf
aidha ingest rss --feed https://blog.example.com/feed.xml
aidha ingest voice --file ./note.m4a
aidha ingest meeting --file ./standup.wav
aidha ingest podcast --feed <url> --episode <guid>
aidha ingest readwise --since 2026-05-01
aidha ingest email --file ./thread.eml
aidha ingest linkedin --paste
```
