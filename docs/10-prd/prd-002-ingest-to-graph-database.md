---
document_id: AIDHA-PRD-002
owner: Ingestion Product Lead
status: Draft
last_updated: 2026-01-24
version: '0.3'
title: Ingest to Graph Database
type: PRD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PRD-002
> **Owner:** Ingestion Product Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-01-24
> **Type:** PRD

## Version History

| Version | Date       | Author | Change Summary                                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Skeleton PRD created                                     | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0 (ID + metadata + filename) | —         | Draft  | —         |
| 0.3     | 2026-01-24 | Codex  | Flesh out ingestion requirements and acceptance criteria | —         | Draft  | —         |

---

## Executive Summary

AIDHA needs a repeatable ingestion pipeline that takes external sources (starting with YouTube),
extracts structured content (metadata + transcripts), classifies it using the shared taxonomy, and
persists it into the cognition graph with provenance. The pipeline should also produce human-facing
summaries and AI-friendly exports (JSON-LD).

This PRD specifies the ingestion engine’s MVP behavior, interfaces, idempotency guarantees, and test
requirements so coding models can implement features safely and incrementally.

## Problem Statement

Without a robust ingestion pipeline:

- knowledge capture is manual and inconsistent,
- provenance is lost (hard to trust later),
- taxonomy tags drift (hard to retrieve),
- graph data becomes noisy/non-deterministic (hard to diff and validate),
- summaries/commentary are not reproducible.

## Objectives & Success Metrics

### Objectives

1. Ingest a playlist (and/or explicit list of video IDs) into the graph.
2. Persist provenance-rich Resource/Knowledge nodes with stable IDs.
3. Classify ingested items using taxonomy tags (MVP: keyword/alias matching; later: model-assisted).
4. Track ingestion jobs with progress and errors (re-runnable and inspectable).
5. Produce deterministic outputs suitable for:
   - local inspection (Markdown/JSON summaries),
   - graph export (JSON-LD).

### Success Metrics (MVP targets)

- A single command can ingest a small playlist end-to-end locally (no manual steps beyond providing
  IDs and any needed keys).
- Re-running ingestion is idempotent (no duplicate nodes/edges for already-ingested videos).
- Tests cover the entire pipeline using mock clients (CI does not require network access).
- Ingestion outputs include enough metadata to trace source and time of ingestion.

## Users & Use Cases

### Primary Users

- **Human operator** capturing learning material into their graph.
- **Agent/coding model** implementing ingestion steps, prompts, and evaluations.

### Use Cases (MVP)

1. Ingest a playlist using a mock client (tests/dev).
2. Ingest one video by ID/URL and store:
   - video metadata,
   - transcript text (when available),
   - provenance (source URI, ingestion timestamp, pipeline version).
3. Assign taxonomy tags based on transcript content (MVP heuristic classifier).
4. Export a deterministic JSON-LD snapshot to share or diff.

## Scope

### In Scope (MVP)

- Package: `packages/praecis/youtube/`.
- A pipeline that accepts:
  - playlist ID (mock client supported),
  - video ID/URL list (real client supported even if playlist fetch is not).
- Job tracking data model (job id, status, progress, errors, timestamps).
- Graph writes (nodes and edges) using the GraphStore contract (AIDHA-PRD-001).
- Taxonomy reads/writes using the TaxonomyRegistry contract (AIDHA-PRD-003).
- Classification MVP:
  - tag assignment by matching `tag.name` or `tag.aliases` against transcript content.
- A CLI entrypoint (local dev first) and DocOps documentation for how to run it.

### In Scope (Next)

- Persistent job records (so job history survives process exit).
- Real playlist fetching (requires Data API key or alternative scraping strategy; capture in ADR).
- Model-assisted tagging and summarization with evaluation harnesses and fixtures.
- Retry, rate limiting, and caching strategies for real network ingestion.

## Out of Scope

- Running ingestion as a hosted service (MVP is local CLI).
- Real-time streaming ingestion.
- Multi-tenant auth and user management.

## Requirements

### Functional Requirements

FR-1. **Input handling**

- The CLI MUST accept either:
  - a playlist identifier, OR
  - one or more video IDs/URLs.
- The pipeline MUST normalize IDs (e.g., parse from URLs where applicable).

FR-2. **Graph persistence**

- For each ingested video, create a Resource (or Knowledge) node with:
  - stable node ID format (recommended: `youtube-<videoId>`),
  - label/title,
  - transcript text stored in `content` (if available),
  - metadata containing minimally:
    - `videoId`, `channelId`, `channelName`, `publishedAt`, `duration`, `thumbnailUrl`,
    - `source: "youtube"`,
    - provenance fields (see FR-4).
- Create edges where meaningful:
  - `partOf` relationships for playlist → video (if playlists are represented),
  - `taggedWith` relationships for tag assignments (recommended once tags are graph-addressable).

FR-3. **Taxonomy integration**

- The pipeline MUST load tags from the taxonomy registry and assign tags to nodes.
- Tag assignments MUST record:
  - `nodeId`, `tagId`,
  - optional `confidence` (0..1),
  - assignment source (manual/automatic).

FR-4. **Provenance**

- Every ingested item MUST record:
  - `sourceType` and `sourceUri` (when known),
  - `ingestedAt` timestamp,
  - `pipelineVersion` (or git SHA) when available.

FR-5. **Job tracking**

- Each ingestion run MUST produce a job result with:
  - status: `running | completed | failed` (or equivalent),
  - progress counters (`total`, `completed`, `failed`),
  - per-video errors with timestamps and messages.

FR-6. **Idempotency**

- Re-ingesting the same video MUST NOT create duplicate nodes.
- Re-ingesting the same playlist SHOULD NOT create duplicate nodes for the same video IDs.
- Idempotency must be true across process restarts once persistence is added (Next scope).

FR-7. **Summaries / commentary outputs (MVP-lite)**

- The pipeline MUST be able to emit a deterministic summary artifact per run:
  - JSON report (job + counts + node IDs),
  - optional Markdown summary for human review.

### Non-Functional Requirements

NFR-1. **No-network CI**

- CI/unit tests MUST run without network access using a mock YouTube client.
- Network tests, if any, MUST be opt-in/skipped by default.

NFR-2. **Deterministic outputs**

- Given the same mock inputs and taxonomy, the pipeline MUST produce stable outputs (node IDs,
  tag assignments, export order) so tests can use fixtures.

NFR-3. **Resilience**

- The pipeline MUST continue processing other items when one item fails, and surface errors in the
  job result.

### Constraints

- Must build and test as a TypeScript ESM package.
- Avoid storing secrets in the repo; prefer env vars for any API keys (when introduced).

## Public Interfaces (What Coding Models Implement Against)

### Pipeline API

- A composable pipeline class/function that takes:
  - a `GraphStore`,
  - a `TaxonomyRegistry`,
  - a `YouTubeClient`.

### CLI API (MVP)

Define a CLI entrypoint with behavior equivalent to:

- `pnpm -C packages/praecis/youtube ingest --playlist <id>`
- `pnpm -C packages/praecis/youtube ingest --video <id-or-url> [--video ...]`

The CLI MUST exit non-zero on overall failure and MUST print the job summary artifact path.

## Acceptance Criteria (Protected by Tests)

Ingestion is acceptable for downstream use when:

1. Pipeline integration tests pass using mock YouTube client and in-memory graph/taxonomy.
2. Idempotency is enforced (no duplicate nodes on rerun for the same mock playlist).
3. Job status and progress are correct for:
   - empty playlists,
   - mixed success/failure runs,
   - invalid playlist/video inputs.
4. The emitted summary artifact is deterministic for fixture inputs.

Suggested test placement:

- `packages/praecis/youtube/tests/pipeline.test.ts` for end-to-end ingestion behavior.
- `packages/praecis/youtube/tests/client.test.ts` for ID parsing and client contracts.

## Dependencies

- AIDHA-PRD-001 (Graph Database) for node/edge contracts and JSON-LD export requirements.
- AIDHA-PRD-003 (Taxonomy) for tag schemas and assignment contracts.
- AIDHA-ADR-004 (Ingestion Architecture and Summarization Strategy) for playlist fetching strategy,
  prompt strategy, and long-term architecture decisions.
- AIDHA-FDD-001 (Ingestion Engine Design) for concrete interface and workflow design.

## Risks & Mitigations

- Risk: YouTube API instability and rate limiting.
  - Mitigation: mock-first tests; opt-in network tests; caching and backoff in Next scope.
- Risk: Tag drift / noisy tagging reduces retrieval quality.
  - Mitigation: taxonomy governance + evaluation fixtures; keep MVP classifier simple and measurable.
- Risk: Non-deterministic ingestion creates noisy diffs.
  - Mitigation: stable IDs + deterministic export/summaries + fixture tests.

## Open Questions

1. What is the canonical representation of a playlist in the graph (node type and edge semantics)?
2. Where should job records live long-term (graph nodes, separate store, or filesystem artifacts)?
3. How do we version prompts and summarization outputs (DocOps metadata + eval harness)?
