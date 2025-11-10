---
document_id: DOCS-INDEX
owner: DocOps Working Group
status: Draft
last_updated: 2025-11-09
version: 0.1
type: overview
---

> **Document ID:** DOCS-INDEX
> **Owner:** DocOps Working Group
> **Approvers:** —
> **Status:** Draft
> **Last Updated:** 2025-11-09

# AIDHA Workspace Documentation

Welcome to the MkDocs-powered documentation portal. Content mirrors the numeric directory tree in
`docs/` and the pnpm workspace packages:

- Governance lives under `00-governance/` (standards, style guides, taxonomy).
- Product/engineering artifacts (PRDs/ADRs/FDDs) live under the numbered folders (10-, 20-, 30-, ...).
- Package-specific quickstarts/runbooks reside next to their code but are surfaced through navigation
  for convenience.

## Editing Workflow
1. Install documentation dependencies: `pip install -r docs/requirements-docs.txt`.
2. Run `mkdocs serve` (or `pnpm docs:serve`) to preview at `http://127.0.0.1:8000`.
3. Every change must include YAML front matter + metadata block per `docs/00-governance/Document_Standards.md`.
4. Before merging, run `mkdocs build` (or `pnpm docs:build`) to ensure the site compiles.

## Next Steps
- Flesh out PRDs/ADRs/FDDs with real content.
- Add search enhancements (Material built-in) and versioning via `mike` when needed.
- Automate catalog generation into `docs/01-indices/catalog.json` for agent/RAG consumption.
