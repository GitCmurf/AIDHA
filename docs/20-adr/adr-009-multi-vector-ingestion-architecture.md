---
document_id: AIDHA-ADR-009
owner: Ingestion Engineering Lead
status: Approved
last_updated: 2026-05-21
version: '1.0'
title: Multi-Vector Ingestion Architecture (Four-Axis Composition)
type: ADR
docops_version: '2.0'
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-009
> **Owner:** Ingestion Engineering Lead
> **Approvers:** Self-review, adversarial GPT + Gemini review (via plan-007)
> **Status:** Approved
> **Version:** 1.0
> **Last Updated:** 2026-05-21
> **Type:** ADR

## Version History

| Version | Date       | Author | Change Summary                                                  | Reviewers | Status   | Reference       |
| ------- | ---------- | ------ | --------------------------------------------------------------- | --------- | -------- | --------------- |
| 1.0     | 2026-05-21 | AI     | Initial ADR: four-axis composition model, open questions Q1/Q4 resolved | Self-review | Approved | AIDHA-PLAN-007 |

## Context

AIDHA's MVP ingestion pipeline (AIDHA-ADR-004, AIDHA-FDD-001) proved the `Resource → Excerpt → CandidateClaim → Claim` workflow end-to-end against a single vector: YouTube transcripts. That implementation (`packages/praecis/youtube`) hardwires three concerns:

1. **Source acquisition** — YouTube-specific (`yt-dlp`, `YouTubeClient`).
2. **Addressing** — timestamp-native (`timestampSeconds`, `timestampLabel`, `timestampUrl`).
3. **Processing** — no modality abstraction; caption fetch is entangled with pipeline orchestration.

Adding a second vector (PDF, RSS, voice note, …) by copying this pattern produces O(n) duplicated pipeline code, incompatible addressing schemes, and no shared dedup logic.

**Driving forces:**

- AIDHA-PLAN-007 specifies eight ingestion vectors (web, PDF/document, RSS, voice, meeting, podcast, Readwise, email) plus a LinkedIn paste bridge.
- AIDHA-STRATEGY-002 §5.3 requires deterministic, locally-reproducible outputs; §5.5 requires export-friendly provenance.
- AIDHA-PRD-002 NFR-1 requires no-network CI (every IO boundary mockable).
- Pre-alpha status means no persisted production graphs — schema changes are clean breaks; no migration is required.

## Decision

Adopt a **four-axis composition architecture** as the single ingestion model for all vectors:

### The Four Axes

Every vector is a declarative composition of four independent axes. Each axis has a defined interface; the implementations are swappable and testable in isolation:

| Axis | Interface | Responsibility | Where |
| ---- | --------- | -------------- | ----- |
| **Acquire** | `IIngestor` | Source-specific retrieval, canonical ID derivation, provenance, sensitivity declaration | `packages/praecis/sources/<vector>/` |
| **Decode** | `IDecodeStrategy[]` | Modality → `MediaSegment[]` (ordered chain; each strategy is composable) | `packages/praecis/decode/` |
| **Contextualize** | `IContextProvider` | Produces `ExtractionContext` sidecar from source metadata | per-vector |
| **Extract** | shared spine | `chunk → mine → edit → claim → export` — written once in `praecis/core` | `packages/praecis/core/` |

### The Source/Modality Separation

The PoC conflated two orthogonal concerns:

- **Source/provenance** — *where it came from* (determines canonical ID scheme, sensitivity, provenance structure).
- **Modality/processing** — *what form it is in* (determines the decode chain: text-extract, transcribe, diarize, OCR, passthrough).

A vector is the composition of a source with a processing chain. Two vectors sharing a source family but differing in processing (voice note vs meeting: same audio acquisition, meeting adds diarisation) differ by one composed decode step — not a class hierarchy.

### Composition Over Inheritance

`Meeting extends Voice extends Audio` chains are rejected. Rationale: inheritance couples unrelated vectors through a base class, forces every shared change through the hierarchy, and breaks the moment a vector needs to *omit* an inherited step. Composition expresses the same relationships without the coupling:

- **Meeting** = voice's decode chain **plus** a `diarize` step (one-line difference in a `VectorSpec`).
- **Podcast** = voice's decode chain **plus** richer `ExtractionContext` (show notes, description).

### Key Type Contracts

**`Locator`** (discriminated union — replaces timestamp-hardcoded addressing):

```ts
type Locator =
  | { kind: 'timecode'; startSec: number; endSec: number; speaker?: string }
  | { kind: 'page'; page: number; charStart: number; charEnd: number }
  | { kind: 'dom'; textFragment: string; charStart: number; charEnd: number }
  | { kind: 'message'; messageId: string; charStart: number; charEnd: number }
  | { kind: 'text'; charStart: number; charEnd: number }
  | { kind: 'external'; system: string; externalId: string };
```

**`MediaSegment`**: atomic addressable unit produced by Decode. Carries a `Locator` plus either resolved `text` (v1 text path) or a `mediaRef` (forward-compatible seam for future direct-multimodal mining — not consumed in v1).

**`ExtractionContext`**: sidecar injected into the candidate miner prompt; the *only* channel from a vector into the extraction spine. No vector subclasses or patches the miner; different extraction emphasis is expressed through chunking hints and source summaries.

**`RawSource`**: Acquire output — canonical ID, dedupKeys, sourceType, sensitivity, provenance, opaque payload.

### Error Model

- **`Result<T>`** from `@aidha/taxonomy` is re-exported by `praecis/core` (not redefined).
- **Partial decode is a success** (`ok` + `warnings: DecodeWarning[]`), not an all-or-nothing error.
- **Acquire failure is terminal** for that input — no stub Resource is persisted.

### Canonicalisation & Dedup

- **`urlCanonical(rawUrl: string): string`** — fetch-independent pure function in `praecis/core`. Shared by `web`, `rss`, and `readwise` so the same article yields the same `web:<canonicalUrl>` primary ID regardless of which vector arrives first.
- Post-fetch artefacts (`rel=canonical`, redirect-target URL) are `dedupKey`s, never promoted to primary IDs.
- Dedup: strong identity match → merge (append `Provenance`, add `alsoSeenVia` edge). Distinct canonical Resources judged equivalent → `corroboratedBy` edge. No provenance is ever discarded.

### Sensitivity Gating

Two-stage: (1) compose/registration time — fail early if a `confidential` vector has no satisfiable LLM backend; (2) run time — route per Resource against the active vector's `sensitivity` before any miner call.

### Package Layout

```text
packages/praecis/
├── core/           @aidha/praecis-core  — spine, interfaces, compose, dedup, export
├── acquire/webfetch, acquire/feed       — acquisition helpers
├── decode/text, transcribe, diarize, ocr — decode strategies
└── sources/youtube, web, pdf, feeds, voice, meetings, readwise, email, linkedin
```

Dependency rule: `sources/* → {acquire/*, decode/*, core}`; `core → {reconditum, phyla, config}`; no `core → acquire/decode/sources` edges; no `source → source` edges.

## Open Questions Resolved

### Q1 — Multi-provenance Representation

**Decision:** `provenances: Provenance[]` array on the Resource node (in `KnowledgeMetadata`).

**Rationale:** Simpler query surface — no join across `hasProvenance` edges needed to read all provenances for a Resource. The `corroboratedBy` edge handles the distinct-canonical-Resource case where two different Resources are judged to represent the same work. `alsoSeenVia` records additional provenance contexts on the *same* Resource (same canonical ID, second arrival vector).

**Trade-off accepted:** If the provenance array grows very large (hundreds of entries), a separate `Provenance` node approach would be more efficient. At the AIDHA scale (personal knowledge management, single user), this is not a realistic concern.

### Q4 — Cross-Session Speaker Identity

**Decision:** Per-recording speaker labels only (`Speaker 1 … N` or diariser-assigned labels). No cross-session speaker identity unification in v1.

**Rationale:** Cross-session unification requires a persistent speaker-identity store and a matching strategy (voice embeddings or manual curation), both out of scope for plan-007. Diarisation outputs per-recording labels; the `timecode` `Locator.speaker` field stores them as-is. A future plan may introduce `Person` node unification.

## Consequences

**Positive:**

- Adding a vector requires implementing `IIngestor`, composing decode strategies, and calling `composeVector()` — no pipeline duplication.
- All vectors share the extraction spine (claim quality improvements benefit all).
- `urlCanonical()` purity ensures cross-vector dedup is reliable and deterministic.
- Sensitivity gating is in `core`, tested once, enforced everywhere.
- `mediaRef` seam means the data model won't break when direct-multimodal mining is added later.

**Negative / accepted trade-offs:**

- Phase 0 refactoring of `praecis/youtube` is non-trivial (but gated by the semantic-equivalence golden snapshot).
- The `composeVector` + `PipelineRuntime` assembly layer adds indirection vs the current monolithic `IngestionPipeline`.
- Partial-decode `DecodeWarning` channel adds complexity at the Decode/spine boundary.

## References

- AIDHA-PLAN-007 §3–§5 (architecture, types, interface contracts)
- AIDHA-ADR-004 (prior ingestion architecture)
- AIDHA-PRD-002 (ingest-to-graph requirements, to be revised under plan-007)
- AIDHA-STRATEGY-002 §5.2–§5.5, §9.4 (provenance, determinism, cost controls)
