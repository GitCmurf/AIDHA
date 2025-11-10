# DocOpsChat Checklist (Reusable)

> Use this checklist to bootstrap DocOps across repos. Check items off as you implement them. Sub-bullets indicate suggested tools or concrete steps. Optionals are marked (optional).

## 1) Repository-wide DocOps Foundations
- [ ] Establish numeric docs tree under `docs/` (00–99)
  - [ ] 00-governance (standards, style, taxonomy, versioning rubric)
  - [ ] 01-indices (catalog.json; linkcheck reports; search indices)
  - [ ] 10-prd, 20-adr, 30-fdd, 40-design, 50-runbooks, 60-devex, 70-specs, 80-decisions, 99-archive
- [ ] Document Standards file with: YAML front matter, visible metadata block, Version History table, status vocabulary, Document ID scheme, controlled vocabulary (Draft/In Review/Approved/Published/Superseded)
- [ ] Writing Style Guide (prose rules: tense, tone, inclusivity, accessibility)
- [ ] Taxonomy doc (tags, systems, domains, subdomains; cross-ref via metadata)
- [ ] Add Markdown lint config (.markdownlint.json); configure IDE integration
- [ ] Add prose linter (Vale) with minimal style (optional)
- [ ] (optional) Add spell-checker integration (cSpell / codespell)

## 2) MkDocs Site (local-first)
- [ ] Add `mkdocs.yml` using Material theme + extensions
  - [ ] Enable features: navigation.sections/instant/top, content.code.copy/action.edit
  - [ ] markdown_extensions: toc, admonition, def_list, attr_list, tables, codehilite, footnotes
  - [ ] plugins: search, literate-nav (docs/_nav.yml), section-index, macros, git-revision-date-localized
- [ ] Add `docs/_nav.yml` mapping Governance → PRD/ADR/FDD → Runbooks → DevEx
- [ ] Add `docs/index.md` explaining editing workflow, metadata conventions, and versioning standards
- [ ] Requirements file: pin compatible versions (e.g., mkdocs 1.5.x with mkdocs-material 9.5.x)
- [ ] Package scripts: `docs:serve` and `docs:build`
- [ ] Local-only hosting (skip GH Pages for private repos); plan CI build-only gate
- [ ] Add versioned docs with `mike` (optional, later)
- [ ] Enhance search: lunr or Algolia (optional, later)
- [ ] (optional) Add dark/light mode and logo to reinforce identity

## 3) Doc Indexing & Agent Readiness
- [ ] Generate `01-indices/catalog.json` from YAML front matter
  - [ ] Add generator script (e.g., Python + PyYAML)
  - [ ] Run generator in `docs:build` (CI gate)
  - [ ] Validate catalog.json against JSON schema (schema file under 00-governance)
- [ ] (optional) Linkcheck report into `01-indices/`

## 4) Product/Architecture Artifacts
- [ ] Create PRDs for initial systems (e.g., GRAPH-PRD, TAX-PRD, INGEST-PRD)
- [ ] Create ADRs (e.g., GRAPH-ADR-001, TAX-ADR-001, INGEST-ADR-001)
- [ ] Create FDDs where design details exceed ADR scope (e.g., INGEST-FDD-001)
- [ ] Runbooks and quickstarts for operational + onboarding flows
- [ ] Version tables maintained (past tense), linked to Git tags/commits when relevant; pre-commit verifies presence
- [ ] (optional) Generate document summaries or embeddings for RAG

## 5) Monorepo + Packages (pnpm)
- [ ] Initialize pnpm workspace (`package.json`, `pnpm-workspace.yaml`)
- [ ] Create packages with consistent structure (`src/`, `tests/`, `docs/`, `ops/`, `prompts/`)
- [ ] Keep canonical quickstarts/runbooks in `docs/` and link from packages (avoid duplication)
- [ ] Add package README pointers back to canonical docs
- [ ] Include internal package docs index in `docs/01-indices/` via build script

## 6) Governance, CI and Enforcements
- [ ] Repository Constitution references DocOps standards; define minimal gates for TDD + DocOps readiness
- [ ] Pre-commit: validate YAML front matter, schema conformance, and Version History presence; regenerate catalog automatically
- [ ] CI: run `pnpm docs:build` (fail on errors), lint markdown, run Vale (optional)
- [ ] (optional) Deploy step for public sites (mkdocs build → host of choice)
- [ ] Tagging convention for docs (e.g., `doc-vX.Y`) and release notes linking
- [ ] (optional) Generate CHANGELOG.md from doc version tables for top-level visibility
- [ ] (optional) CI summary: doc coverage stats (how many docs have version metadata)
 - [ ] (optional) Pre-commit framework: `.pre-commit-config.yaml`, developer onboarding instructions

## 7) Authoring Ergonomics
- [ ] VS Code: Markdown All in One, Markdown Table Prettify/Formatter, Vale integration, YAML schema validation
- [ ] Add template snippets for metadata + version table (VS Code snippet or `.md` template)
- [ ] CSV→table workflow or AI-assist to reduce table friction
- [ ] Clear guidance on tense: imperative for commits; past tense for doc version logs
- [ ] Document ID conventions (`<AREA>-<TYPE>-<SEQ?>`), Status vocabulary, semantic versioning rule (major.minor)

## 8) Roadmaps & Cross-Cutting
- [ ] DevEx roadmap capturing phases, gates, and handoffs
- [ ] Observability guidance (structured logs, metrics, tracing) referenced by runbooks
- [ ] RAG alignment: stable paths, predictable headings, consistent metadata; ensure all docs expose embeddings or semantic summary; predictable heading hierarchy
