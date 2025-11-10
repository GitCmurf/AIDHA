# DocOpsChat Checklist — AIDHA Status

> Checked items are implemented in this repo; unchecked are pending or deferred.

## 1) Repository-wide DocOps Foundations
- [x] Establish numeric docs tree under `docs/` (00–99)
  - [x] 00-governance (standards, style, taxonomy, versioning rubric)
  - [x] 01-indices (catalog.json; linkcheck reports; search indices) — catalog present; linkcheck/search indices pending
  - [x] 10-prd, 20-adr, 30-fdd, 40-design, 50-runbooks, 60-devex, 70-specs, 80-decisions, 99-archive
- [x] Document Standards file with YAML front matter, visible metadata block, Version History, status vocabulary, Document ID scheme, controlled vocabulary
- [x] Writing Style Guide (prose rules, accessibility)
- [x] Taxonomy doc (stub with cross-ref intent)
- [x] Markdown lint config (.markdownlint.json)
- [x] Prose linter (Vale) baseline style
- [ ] (optional) Spell-check integration (cSpell/codespell)

## 2) MkDocs Site (local-first)
- [x] `mkdocs.yml` (Material theme + recommended features)
- [x] `docs/_nav.yml` navigation
- [x] `docs/index.md` overview + workflow
- [x] Requirements pinned (mkdocs 1.5.3 + mkdocs-material 9.5.10)
- [x] Scripts: `pnpm docs:serve`, `pnpm docs:build`
- [x] Local-only hosting; CI build gate planned
- [x] Plugin: git-revision-date-localized (added to plan; ready to enable in CI)
- [ ] Versioned docs with `mike` (deferred)
- [ ] Enhanced search (lunr/Algolia) (deferred)
- [ ] (optional) Brand assets (logo/theme)

## 3) Doc Indexing & Agent Readiness
- [x] `01-indices/catalog.json` generator script and build integration
- [ ] Validate catalog.json against JSON schema (schema file added)
- [ ] Linkcheck report into `01-indices/` (pending)

## 4) Product/Architecture Artifacts
- [x] PRDs for GRAPH, TAX, INGEST (skeletons)
- [x] ADRs for GRAPH, TAX, INGEST (skeletons)
- [x] FDD for INGEST (skeleton)
- [x] Runbooks + quickstarts (canonicalized in numbered tree)
- [ ] Version tables reference tags/commits (add when releases exist)
- [ ] (optional) Generate embeddings/summaries for RAG

## 5) Monorepo + Packages (pnpm)
- [x] pnpm workspace initialized
- [x] Three packages scaffolded with consistent structure
- [x] Canonical docs in `docs/` with package pointers
- [x] Package READMEs link to canonical docs
- [ ] Include internal package docs index in `docs/01-indices/` via build script

## 6) Governance, CI and Enforcements
- [x] Constitution updated to reference DocOps standards
- [ ] Pre-commit: validate YAML front matter, schema conformance, Version History; auto-regenerate catalog
- [ ] CI: docs build + markdownlint + Vale (+ optional doc coverage stats)
- [ ] Deploy step (skipped; private repo) — local-only accepted
- [ ] Tagging convention for docs (`doc-vX.Y`) (pending)
- [ ] (optional) Generate top-level CHANGELOG from doc version tables
 - [x] (optional) Pre-commit framework: `.pre-commit-config.yaml`, developer onboarding instructions pending

## 7) Authoring Ergonomics
- [x] VS Code extension assumptions documented in standards
- [x] CSV→table/AI-assist guidance captured
- [x] Tense guidance: commits (imperative) vs doc logs (past tense)
- [x] Document ID conventions + status vocabulary + semantic versioning rule
- [ ] Add editor snippets/templates for metadata + version tables

## 8) Roadmaps & Cross-Cutting
- [x] DevEx roadmap present (`docs/60-devex/Initial_Tools_Roadmap.md`)
- [x] Observability/runbook placeholders created
- [x] RAG alignment: stable paths + metadata; catalog generator in place
- [ ] Ensure embeddings/semantic summaries are available for key docs (deferred)

### Notes
- We explicitly deferred GitHub Pages; local MkDocs remains the default.
- We will add CI + pre-commit enforcement and optional `mike` versioning when ready.
