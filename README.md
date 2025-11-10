# AIDHA Workspace

This repository hosts automation templates and prompts for Specify-style feature development. Start by reading `AGENTS.md` for workflow guidance, `docs/00-governance/Document_Standards.md` for DocOps conventions, and the `.specify/templates/` directory for SpecKit source files.

## Quick Start
1. Run `bash .specify/scripts/bash/check-prerequisites.sh` to verify tooling.
2. Create a spec branch with `bash .specify/scripts/bash/create-new-feature.sh "Describe feature" --short-name feature-name`.
3. Populate the generated `specs/<number>-<short-name>/` folder before implementing code.

## Repository Structure & DocOps

```
docs/
  00-governance/        # standards, style, taxonomy
  01-indices/           # generated catalogs for RAG
  10-prd/               # Product Requirements Docs
  20-adr/               # Architecture Decision Records
  30-fdd/               # Feature Design Documents
  40-design/            # Design explorations
  50-runbooks/          # Operational guides
  60-devex/             # Developer experience / tooling docs
  70-specs/             # High-level specs
  80-decisions/         # Non-architectural decisions
  99-archive/           # Superseded docs
packages/               # pnpm workspace packages (graph-backend, taxonomy, ingestion, ...)
specs/<id>-<slug>/      # SpecKit plans/tasks for in-flight work
```

- All documents under `docs/` must include the YAML front matter + metadata + version history described in `docs/00-governance/Document_Standards.md`.
- `.gitignore` tracks common build artifacts, language dependencies, and spec-specific outputs.
- `.gitattributes` enforces LF line endings and provides better diffs for Markdown and shell scripts.
- CI should run `pnpm lint`, `pnpm test`, and docs/quickstart verification to mirror the DevOps + DocOps coupling defined in `AGENTS.md` and the Constitution.
- `.gitignore` tracks common build artifacts, language dependencies, and spec-specific outputs.
- `.gitattributes` enforces LF line endings and provides better diffs for Markdown and shell scripts.
- `docs/Document_Standards.md` defines required metadata blocks, version tables, and document IDs; every PRD/ADR/FDD/runbook must follow it.
- CI should run `pnpm lint`, `pnpm test`, and docs/quickstart verification to mirror the DevOps + DocOps coupling defined in `AGENTS.md` and the Constitution.

## Initial Toolchain Focus
The first three interdependent tools share the same DocOps gates:

1. **Graph Knowledge Backend (`packages/graph-backend/`)** – a pnpm workspace package exposing the personal cognition graph API plus JSON-LD export and contract tests.
2. **Knowledge Taxonomy & Metadata (`packages/taxonomy/`)** – classification schemas, ontology definitions, and governance for responsibilities/projects with AI-friendly metadata.
3. **Ingestion Engine (`packages/ingestion-youtube/`)** – pipeline that processes YouTube playlists, captures transcripts, classifies against the taxonomy, enriches metadata, summarizes insights, and emits editorial commentary.

See `docs/60-devex/Initial_Tools_Roadmap.md` for the detailed DocOps and implementation tasks for these packages.

## MkDocs Documentation Site
1. Install dependencies: `pip install -r docs/requirements-docs.txt`.
2. Preview locally: `pnpm docs:serve` (opens http://127.0.0.1:8000).
3. Build for CI/CD: `pnpm docs:build` (fails on missing metadata or broken links).

Navigation is defined in `docs/_nav.yml` (used by `mkdocs-literate-nav`). All documents surfaced on the
site must live in the numeric `docs/` tree or within package directories and include the mandated YAML
front matter + metadata blocks.

Each package requires: (a) PRD + ADR using the metadata/Version History template, (b) TDD-first implementation with coverage ≥80%, (c) DocOps artifacts (quickstart, runbook, prompts) tracked alongside code.
