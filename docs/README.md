---
document_id: DOCS-ROOT
owner: DocOps Working Group
status: Draft
last_updated: 2025-11-09
version: 0.1
type: overview
---

> **Document ID:** DOCS-ROOT  
> **Owner:** DocOps Working Group  
> **Approvers:** —  
> **Status:** Draft  
> **Last Updated:** 2025-11-09  

# Documentation Tree

The `docs/` directory follows a numeric, type-based structure for predictability and agent-readiness:

- `00-governance/` – standards, style, taxonomy, versioning rubric, schemas
- `01-indices/` – generated indices (e.g., `catalog.json`, linkcheck reports)
- `10-prd/` – Product Requirements Documents
- `20-adr/` – Architecture Decision Records
- `30-fdd/` – Feature Design Documents
- `40-design/` – design explorations/whitepapers
- `50-runbooks/` – operational guides/runbooks
- `60-devex/` – developer experience/tooling notes
- `70-specs/` – high-level specifications
- `80-decisions/` – non-architectural decision logs
- `99-archive/` – superseded docs

Templates for PRD/ADR/FDD live in `docs/_templates/`. The document catalog schema is in `00-governance/catalog.schema.json`.
