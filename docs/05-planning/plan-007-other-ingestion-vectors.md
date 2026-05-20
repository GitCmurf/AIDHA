---
document_id: AIDHA-PLAN-007
owner: Ingestion Engineering Lead
status: Draft
version: "0.3"
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
> **Version:** 0.3
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

## Objective

Extend AIDHA ingestion beyond the YouTube transcript proof-of-concept to eight
fully-specified vectors — **web pages, PDFs/documents, RSS articles, voice notes,
multi-person meetings, podcasts, Readwise highlights, and Outlook/email via file
import (`.eml`/`.msg`; tag-triggered Graph API sync deferred to AIDHA-PLAN-008)**,
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
strategies live in `packages/praecis/decode/*`; each vector is a thin adapter under
`packages/praecis/sources/*`. Vectors register through the `SourceRegistration`
contract delivered by AIDHA-PLAN-005 (Phase 5A–5E), which is the gating dependency.

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
  for them (it accepts pre-fetched DOM text) but does not build them here.
- **Microsoft Graph API email sync.** Email ships file-import (`.eml`/`.msg`) here;
  tag-triggered Graph API sync is deferred to AIDHA-PLAN-008.
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
  - `packages/praecis/decode/webfetch` — `IWebFetcher` + backends.
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
   graphs (`core` depends on `reconditum`/`phyla`/`config`; `decode/*` depend on
   `core`; `sources/*` depend on `core` + the `decode/*` they compose).

## Terminology

- **Vector** — a named ingestion source (e.g. `web`, `voice`) expressed as a
  composition of the four axes plus a `SourceRegistration`.
- **MediaSegment** — the atomic addressable unit produced by Decode: a `Locator`
  plus either resolved `text` or a `mediaRef`, plus optional speaker/section labels.
- **Locator** — a discriminated union describing *where in a source* a segment lives
  (timecode, page, dom, message, or external id).
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
| Config / sources | `@aidha/config` `SourceRegistration` contract | **Lives in `feat/contract-drift-remediation` (AIDHA-PLAN-005 Phase 5A–5E), not yet merged to `main`.** This worktree predates it. |

### The Gap

1. **No reusable pipeline package.** Pipeline logic must be extracted from
   `praecis/youtube` into `praecis/core` so other vectors do not copy it.
2. **No typed addressing abstraction.** Timestamp-hardcoded excerpts and export
   types block page/dom/message addressing.
3. **No acquisition abstraction.** Each vector needs an `IIngestor` it implements;
   transcription/fetching/diarisation/OCR need injectable strategy interfaces.
4. **No multi-provenance / dedup-and-link.** The schema cannot model a canonical
   resource reached through several vectors.
5. **`SourceRegistration` is not on `main`.** The contract every new vector must
   register through is unmerged (see Dependency Gate below).

### Dependency Gate (Resolve Before Phase 0)

> plan-007 Phase 0 **MUST** begin from a `main` that includes the merge of
> `feat/contract-drift-remediation` (AIDHA-PLAN-005 Phase 5A–5E). That branch
> delivers the `SourceRegistration` contract (`youtube-source-adapter.ts`,
> `source-schema.test.ts`, `cli-source-selection.test.ts`). plan-007 does **not**
> re-derive or duplicate this work; it consumes it. Practically: debug and merge
> contract-drift-remediation, recreate this worktree from updated `main`, then start
> Phase 0. This is a hard `blockedBy`, not an "absorb".

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
   provenance and a corroboration edge. No provenance is ever discarded.
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
   sensitivity tier. Output: a `RawSource` (handles + metadata), not text.
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
| Email | file (`.eml`/`.msg`) | `[text-extract]` (+ reply-strip) | medium (thread subject) |
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
  /** Free-form source-supplied context: show notes, abstract, thread subject. */
  sourceSummary?: string;
}

// raw-source.ts — Acquire output (handles + metadata, not text).
export interface RawSource {
  canonicalId: string;          // e.g. "web:https://example.com/a"
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
| **Decode strategies** | `IDecodeStrategy` and its implementations `ITranscriber`, `IDiarizer`, `IWebFetcher`, OCR, text-extract | Injected *into a vector's decode chain*. They produce `MediaSegment[]`; they are not pipeline stages. |

A voice `IIngestor` *uses* an `ITranscriber` to produce segments, then hands them to
the shared spine. The transcriber is a strategy the ingestor composes, sitting
*below* the pipeline, not beside it.

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
├── decode/
│   ├── text/                     @aidha/decode-text   (readability, pdf-to-text, email render)
│   ├── transcribe/               @aidha/decode-transcribe (ITranscriber + backends)
│   ├── diarize/                  @aidha/decode-diarize (IDiarizer + backends)
│   ├── ocr/                      @aidha/decode-ocr    (Tesseract fallback)
│   └── webfetch/                 @aidha/decode-webfetch (IWebFetcher + backends)
└── sources/
    ├── youtube/  (refactored from packages/praecis/youtube)
    ├── web/   pdf/   feeds/   voice/   meetings/   readwise/   email/   linkedin/
```

Dependency rule (enforced by package boundaries): `sources/* → decode/* → core →
{reconditum, phyla, config}`. No `core → decode` or `core → sources` edges; no
`source → source` edges. Source-specific code (email reply-stripping, web
canonicalisation, PDF slide heuristic) lives in its `sources/*` adapter.

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
gain a typed `locator: Locator` field (replacing ad-hoc timestamp keys in
`metadata`). YouTube excerpts use `{ kind: 'timecode', startSec, endSec }`.

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

// IDecodeStrategy — Decode axis. Composable, ordered.
export interface IDecodeStrategy {
  readonly name: string;                // 'text-extract' | 'transcribe' | 'diarize' | 'ocr' | 'passthrough'
  /** Transform raw source (or upstream segments) into segments. */
  decode(ctx: DecodeInput): Promise<Result<MediaSegment[]>>;
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

// IWebFetcher — URL → cleaned DOM text (or accepts pre-fetched DOM for future extension).
export interface IWebFetcher {
  readonly backend: string;             // 'readability' | 'playwright'
  fetch(input: WebFetchInput): Promise<Result<{ url: string; canonicalUrl: string; title: string; text: string }>>;
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
  readonly registration: SourceRegistration;
  /** Convenience: resolve raw input → MediaSegment[] by running ingestor + decode chain. */
  ingestAndDecode(input: IngestInput): Promise<Result<{ raw: RawSource; segments: MediaSegment[] }>>;
}
```

The shared pipeline (`core/src/pipeline/`) consumes a `ComposedVector` and runs:
`acquire → decode(chain) → contextualize → chunk → mine → edit → persist claims →
export`, with idempotency keyed on `canonicalId` and caching keyed on content hashes
(Section 7.5).

---

## 6. Per-Vector Specifications

Each vector is specified with: source ID, canonical ID rule, locator kind,
sensitivity, acquire/decode/context composition, anticipated gotchas with
mitigations, and its test inventory. Order follows the execution phases (Section 8).

### 6.1 Web (`web`) — Phase 1

- **Canonical ID:** `web:<canonicalUrl>` where `canonicalUrl` is the URL after
  resolving redirects and stripping tracking params (`utm_*`, `fbclid`, etc.) and
  honouring `<link rel="canonical">`.
- **Locator:** `dom`. **Sensitivity:** `personal`.
- **Acquire:** CLI `--url`; `IWebFetcher` (readability default; Playwright backend
  for JS-heavy pages, opt-in via config). Architected to also accept *pre-fetched*
  DOM text (future extension passes the body directly — same code path).
- **Decode:** `[text-extract]` (readability → main-content text + char offsets).
- **Context:** medium (page title, meta description, site name).
- **Gotchas → mitigations:**
  - *JS-rendered pages* → Playwright backend behind a config flag; readability is
    default to keep the dependency optional.
  - *Paywalls / login walls* → detect (very short body, known login markers) and
    fail gracefully with a clear message; do not store a stub Resource.
  - *Canonical-URL drift* → resolve `rel=canonical` and redirect chain before ID
    computation so the same article via two URLs dedups.
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

- **Canonical ID:** `rss:<item-guid>` (fallback `web:<canonicalUrl>` if guid
  absent, enabling dedup with the web vector). **Locator:** `dom`.
  **Sensitivity:** `public`.
- **Acquire:** CLI `--feed <url>` (and `--item <guid>`); parse feed, select items;
  fetch full article body via `IWebFetcher` when the feed carries only summaries.
- **Decode:** `[text-extract]` (reuses web text-extract).
- **Context:** medium (feed title, item categories).
- **Gotchas → mitigations:**
  - *Summary-only feeds* → fetch full text via webfetch (shared with web vector).
  - *Re-published items (changed guid, same content)* → secondary content-hash check
    feeds dedup-and-link (Section 7.2).
  - *Feed already covered by web* → shared `web:` canonical fallback dedups.
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
  **same web canonicaliser used by the `web`/`rss` vectors** (Section 6.1); when no
  `source_url` is present (manual highlights, some tweets), it falls back to
  `readwise:book:<bookId>`. Deriving `web:<canonicalUrl>` is what lets the same
  article seen via RSS and via Readwise dedup-and-link to one Resource (Section 7.2).
  Highlights are addressed by `external` locators (`system: 'readwise'`,
  `externalId: <highlightId>`); re-runs stay idempotent on `<highlightId>`.
  (This parent-ID scheme deliberately differs from its siblings — Readwise is a
  re-publication layer over works that have their own identity.) **Locator:**
  `external` (`system: 'readwise'`). **Sensitivity:** `personal`.
- **Acquire:** Readwise REST API (`/export` with `updated_after` for incremental
  sync); token via `${READWISE_TOKEN}` config interpolation. The parent "book"
  (article/book/podcast/tweet source) becomes a Resource; each highlight becomes a
  pre-segmented `MediaSegment`.
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
  `References` header, else `In-Reply-To`, else the message's own `Message-ID`. This
  makes single-message imports stable and lets later messages of the same thread
  dedup-and-link onto the existing Resource (Section 7.2) regardless of import order.
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
  `email-pipeline.test.ts`, `sensitivity-gate.test.ts`; `parse-msg.test.ts` only if
  the `.msg` stretch is taken.

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
- **Dedup-and-link:** when an incoming `canonicalId` matches an existing Resource,
  AIDHA appends the new `Provenance` and adds an `alsoSeenVia` edge — it does **not**
  create a duplicate and does **not** discard the arrival. The same article via RSS
  *and* Readwise becomes one Resource with two provenances **because both derive the
  same `web:<canonicalUrl>`** — RSS via its `web:` fallback (Section 6.3) and Readwise
  via its `source_url`→`web:` derivation (Section 6.7). When no shared `web:` id is
  derivable (e.g. a Readwise highlight with no `source_url`), the two stay distinct
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

### Phase 0 — Foundation (gated on contract-drift merge; no new vectors)

**Precondition:** `feat/contract-drift-remediation` merged to `main`; worktree
recreated from updated `main` (Dependency Gate, Section 1).

- [ ] Record an ADR (`docs/20-adr/adr-009-multi-vector-ingestion-architecture.md`)
      capturing the four-axis composition model, the source-vs-modality split, and
      the multi-provenance decision (array vs nodes — resolve Q1).
- [ ] Revise `AIDHA-PRD-002` (or author a new `AIDHA-PRD-004` "Multi-Vector
      Ingestion") so the product requirements reflect the four-axis architecture and
      the eight vectors, not just YouTube.
- [ ] Create `packages/praecis/core` skeleton (package.json, tsconfig, vitest).
- [ ] Add core types (`Locator`, `MediaSegment`, `ExtractionContext`, `RawSource`)
      with failing schema tests, then implementations.
- [ ] Add `reconditum` schema changes (Locator field on Excerpt; SourceType
      extension; multi-provenance) with contract tests; regenerate YouTube fixtures.
- [ ] Add interfaces (`IIngestor`, `IChunker`, `ICandidateMiner`, `IEditor`,
      `IExporter`, `IDecodeStrategy`, `IContextProvider`) and `composeVector`.
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
- [ ] `decode/webfetch` (`IWebFetcher`: readability default, Playwright opt-in).
- [ ] `decode/ocr` (Tesseract fallback; mockable).
- [ ] `sources/web` — acquire (canonicalise URL), compose `[text-extract]`,
      register, CLI `aidha ingest web --url`.
- [ ] `sources/pdf` — acquire (hash + metadata), compose `[text-extract] ?? [ocr]`,
      slide-vs-paper heuristic, CLI `aidha ingest pdf --file`.
- [ ] `sources/feeds` (rss part) — parse feed, full-text fetch, compose
      `[text-extract]`, CLI `aidha ingest rss --feed`.
- [ ] Dedup-and-link wired (web ↔ rss shared `web:` fallback).

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
overlaps; multi-reply email fixture produces de-duplicated excerpts; attachments
recorded as References, not auto-ingested; runbooks added.

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
| `praecis/core` | `locator.test.ts`, `media-segment.test.ts`, `compose-vector.test.ts`, `pipeline.test.ts`, `export-deeplink.test.ts` (all six locator kinds), `dedup-link.test.ts`, `sensitivity-gate.test.ts`, `determinism.test.ts` |
| `reconditum` | schema contract tests: Locator on Excerpt, extended SourceType, multi-provenance array/edges |
| `decode/text` | readability extract, pdf text + offsets, email render |
| `decode/transcribe` | per-backend mocked clients; VAD trim; chunk-stitch timecodes |
| `decode/diarize` | per-backend mocked; speaker annotation; `none` passthrough |
| `decode/webfetch` | readability vs playwright selection; canonical URL; mocked HTTP |
| `decode/ocr` | fallback trigger; mocked OCR; graceful failure |
| `sources/*` | per-vector: id rule, pipeline (fixture → claims), gotcha-specific tests (Section 6) |

### Integration / CLI

- `aidha ingest <vector> …` for each vector against fixtures (no network).
- `aidha config explain sources.<id>.…` for each registration.
- Cross-vector dedup-and-link integration test, two cases:
  - **Merge:** an RSS item and a Readwise export item whose `source_url` canonicalises
    to the *same* `web:<canonicalUrl>` → **one Resource, two provenances** (asserts the
    Section 6.7 `source_url`→`web:` derivation lands on the RSS `web:` fallback). The
    fixture must use a Readwise item that *carries* `source_url`.
  - **Link, not merge:** a Readwise item with no `source_url` → **two Resources joined
    by `corroboratedBy`**, never silently merged.

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

This section pre-empts the issues GPT and Gemini are most likely to raise. **DoD
target: ≤5 substantive issues per reviewer**, where *substantive* = anything needing
more than a one-line clarification.

| Anticipated concern | Pre-emptive answer |
| ------------------- | ------------------ |
| "Pipeline interfaces and `ITranscriber` are layered confusingly." | Explicit layering rule (Section 3.5): transcriber/diarizer/fetcher are decode strategies *below* the spine, not pipeline peers. |
| "Excerpt addressing is timestamp-hardcoded; this needs migration." | Locator union (Section 4.1) replaces it; **no migration** — pre-alpha, no persisted graphs (Section 4 preamble). |
| "Sending private email/meetings to OpenAI is unsafe." | Per-vector sensitivity tier + `require_local_llm` gate enforced in core before any miner call (Section 7.1). |
| "Same article via two vectors → duplicate resources." | Dedup-and-link (Section 7.2): merge into canonical, append provenance, add `alsoSeenVia`; never duplicate, never discard. |
| "Scanned PDFs have no text layer." | OCR fallback per page (Section 6.2); graceful failure + warning when OCR unavailable. |
| "Quoted replies will duplicate email excerpts 5×." | Reply-strip preprocessor (Section 6.8), tested against multi-reply fixtures. |
| "Which diarisation backend, and how do speakers persist?" | `IDiarizer` backends enumerated (7.7); cross-session speaker identity is an explicit Open Question (Q4), not silently assumed. |
| "LinkedIn can't be fetched unauthenticated." | Acknowledged as a constraint; paste bridge only; extension deferred (Section 6.9, Non-Goals). |
| "Readwise re-sync will duplicate / miss edits." | `updated_after` cursor + idempotency on `highlightId` (Section 6.7). |
| "Cost of transcribing long podcasts is unbounded." | Cost ceilings + pre-run estimate + caching (Section 7.3). |
| "Determinism claims are untested across vectors." | Determinism gate + caching keyed on content hashes (Sections 7.5, 9). |
| "`SourceRegistration` isn't on main yet." | Hard Dependency Gate (Section 1); Phase 0 blocked until merged. |
| "Eight vectors is over-scoped." | Phased with gates; Tier-2/3 explicitly roadmap-only (Appendix A); `mediaRef`/extension are seams, not built. |

---

## 12. Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| contract-drift merge slips → Phase 0 blocked | Treat the merge as the top sequencing priority; Phase 0 has no other prerequisites. |
| Pipeline extraction from `youtube` breaks behaviour | Semantic-equivalence regression gate on regenerated fixtures (Phase 0 acceptance): same claims/provenance/deep-link targets, byte-stable across re-runs. |
| Transcription quality/cost varies by backend | Pluggable backends + fixtures; default cloud, opt-in local; cost ceilings. |
| Diarisation accuracy on noisy meetings | Backend choice + documented best-effort; per-recording labels only in v1. |
| Web/LinkedIn anti-bot fragility | Web defaults to readability; LinkedIn is paste-only; no scraping committed. |
| Scope creep into extension/Graph API | Hard Non-Goals; deferred to PLAN-008. |
| Decode chain abstraction over-engineered | Plain composed functions + registration record; reviewed against "no DI container" principle (§2.8). |

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
6. Adversarial review (GPT + Gemini) raises **≤5 substantive issues each**, with the
   Adversarial Review Resilience section (Section 11) pre-empting the known hit-list.

---

## Dependencies

- **AIDHA-PLAN-005 Phase 5A–5E** (`SourceRegistration` contract) — hard `blockedBy`,
  delivered via `feat/contract-drift-remediation` (Dependency Gate, Section 1).
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
