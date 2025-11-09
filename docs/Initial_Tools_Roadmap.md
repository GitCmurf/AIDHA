# Initial Tools Roadmap

> **Document ID:** ROADMAP-FOUNDATIONAL-TOOLS
> **Owner:** DocOps Working Group
> **Status:** Draft
> **Last Updated:** 2025-11-09

## Version History

| Version | Date       | Author        | Description                           |
|---------|------------|---------------|---------------------------------------|
| 0.1     | 2025-11-09 | DocOps Agent  | Seed roadmap for graph/taxonomy/ingest |

## Overview
This roadmap sequences the first three interdependent packages in the pnpm workspace. Each package
must ship with PRD, ADR, tests, DocOps artifacts, and CI enforcement per the Constitution.

## 1. Graph Knowledge Backend (`packages/graph-backend/`)
**Goal**: Provide a graph-database backend for personal cognition with JSON-LD exports for AI agents.

### Tasks
1. Create `GRAPH-PRD` + `GRAPH-ADR-001` following Document Standards.
2. Implement workspace package with Neo4j (or comparable) connector, schema migrations, and graph-contract tests.
3. Expose CLI/API for CRUD + traversal, returning deterministic JSON.
4. Generate docs: quickstart, runbook, prompts; ensure `pnpm docs:test` validates outputs.
5. Add observability hooks (structured logs, metrics per node/edge mutation) and publish dashboards/runbooks.

## 2. Taxonomy & Metadata (`packages/taxonomy/`)
**Goal**: Define classification taxonomy, project/responsibility structure, and metadata contract for AI retrieval.

### Tasks
1. Author `TAX-PRD` + `TAX-ADR-001` describing ontology governance and change management.
2. Build TypeScript schemas + validation tests for taxonomy definitions and metadata records.
3. Provide migration/upgrade CLI to sync taxonomy with the graph backend; record provenance.
4. Document classification playbooks and embed evaluation datasets for AI agents.
5. Wire CI to ensure taxonomy changes trigger downstream ingest reclass tests.

## 3. YouTube Ingestion Engine (`packages/ingestion-youtube/`)
**Goal**: Process playlists, capture transcripts, classify against the taxonomy, and publish summaries + commentary.

### Tasks
1. Draft `INGEST-PRD` + `INGEST-FDD-001` detailing ingestion flow, rate limits, and editorial outputs.
2. Implement ingestion workers (TypeScript/Node) with retry + idempotency, persisting to graph backend via taxonomy API.
3. Integrate AI summarization/perspective prompts; store prompt files alongside code with evaluation harness.
4. Emit structured metadata packages (summary, key points, editorial notes) for both humans and AI RAG pipelines.
5. Provide quickstart (`pnpm ingest dev --playlist <id>`) and monitoring runbook; add DocOps validation to CI.

## Cross-Cutting DocOps Tasks
- Add pre-commit/CI checks ensuring metadata + version tables exist for any doc inside `docs/` or `specs/`.
- Create shared templates for PRD/ADR/FDD referencing Document Standards and include them in `.specify/templates/`.
- Establish tagging convention (`doc-vX.Y`) to sync document releases with code deployments.

## Dependencies & Sequencing
1. Complete graph backend schema + APIs (milestone: contract tests + docs passing).
2. Finalize taxonomy metadata and integrate with graph backend (milestone: taxonomy validation CI gate).
3. Build ingestion engine on top of stable graph + taxonomy APIs.

Review this roadmap at the end of every release train and update the Version History accordingly.
