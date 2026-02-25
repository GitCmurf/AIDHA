# AIDHA Workspace

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

This repository hosts a pnpm monorepo plus DocOps infrastructure for graph-native personal knowledge
tooling to create an AI-assistant-friendly 'personal cognition graph manager'.

Read `AGENTS.md` for day-to-day workflow guidance and
`docs/00-governance/gov-001-document-standards.md` for documentation rules.

Created by [Colin Farmer](https://github.com/GitCmurf)

---

## Overview

The MVP seeks to prove the concept using YouTube video transcripts as the first ingestion vector,
before moving on to:

1. other ingestion vectors
   - personal voice notes, web pages, PDFs, office docs, etc.
2. expanding out taxonomy and tagging
3. task and project management
   - aiming for AI-assisted 'next action' advice

## Quick Start

1. **Clone & prerequisites**
   - Install [pnpm](https://pnpm.io/) and Python 3.12+
   - `git clone https://github.com/GitCmurf/AIDHA.git`

2. **Install dependencies**
   - `pnpm install` (workspace metadata/scripts)
   - `python3 -m venv .venv && source .venv/bin/activate`
   - `python -m pip install -r docs/requirements-docs.txt` (if used)

3. **Set up tooling**
   - `pip install pre-commit && pre-commit install`

4. **Develop**
   - `pnpm -C packages/reconditum test && pnpm -C packages/reconditum build`
   - `pnpm -C packages/praecis/youtube test && pnpm -C packages/praecis/youtube build`
   - `pnpm docs:serve` to preview the MkDocs site locally

5. **Before pushing**
   - `pnpm docs:build` (runs catalog + validation + mkdocs)
   - ensure all docs follow the metadata + Version History format

## Repository Structure

A full description lives in `docs/60-devex/repo-structure.md`. Summary:

```text
docs/
  00-governance/  # standards, style, taxonomy, schemas, checklists
  01-indices/     # catalog.json, linkcheck artifacts
  10-prd/         # Product Requirements Docs
  20-adr/         # Architecture Decision Records
  30-fdd/         # Feature Design Documents
  40-design/
  50-runbooks/
  60-devex/       # DevEx/tooling docs, quickstarts, roadmap
  70-specs/
  80-decisions/
  99-archive/
packages/          # pnpm workspace packages (reconditum, phyla, praecis)
specs/<id>-<slug>/ # SpecKit plans/tasks for in-flight work
styles/            # Vale/Markdownlint styles
```

- All documents under `docs/` must include the YAML front matter + metadata + Version History
  described in `docs/00-governance/gov-001-document-standards.md`.
- `docs/_templates/` contains skeleton PRD/ADR/FDD files; copy them when creating new documents.
- `docs/_scripts/` houses catalog + validation scripts used by pre-commit/CI.

## Working Agreements

- **DocOps**: `docs/00-governance/gov-001-document-standards.md`,
  `docs/00-governance/gov-004-writing-style-guide.md`.
- **Governance**: `.specify/memory/constitution.md` defines TDD + DocOps gates.
- **Operational checklist**: repo status in `docs/60-devex/docops-checklist-aidha.md`.
- **Changelog**: maintained in `docs/60-devex/changelog.md` (link from root if needed).
- **SpecKit**: use `.specify/scripts/bash/create-new-feature.sh` to scaffold specs; move stable assets
  into `packages/` + `docs/` when complete.

## Initial Toolchain Focus

Three packages evolve together (see `docs/60-devex/initial-tools-roadmap.md`):

1. **Graph Knowledge Backend (`packages/reconditum/`)** – cognition graph APIs, JSON-LD export,
   graph-contract tests.
2. **Knowledge Taxonomy (`packages/phyla/`)** – classification schemas, metadata validation,
   governance tooling.
3. **YouTube Ingestion Engine (`packages/praecis/youtube/`)** – playlist/video ingestion,
   transcript capture, two-pass claim extraction, review queue, and dossier export.

## Current MVP Commands

For a full command list, run:

- `pnpm -C packages/praecis/youtube cli help`

Typical flow:

1. `pnpm -C packages/praecis/youtube cli ingest video <url>`
2. `pnpm -C packages/praecis/youtube cli extract claims <url> --llm --model <id>`
3. `pnpm -C packages/praecis/youtube cli review next <url> --state draft`
4. `pnpm -C packages/praecis/youtube cli export dossier video <url>`
5. `pnpm -C packages/praecis/youtube cli query "<topic>"`

Each package must deliver: PRD/ADR/FDD as applicable, ≥80% coverage with TDD, DocOps assets
(quickstart, runbook, prompts), and observability hooks.

## Documentation Site (MkDocs)

- `pnpm docs:serve` → <http://127.0.0.1:8000> (Material theme).
- `pnpm docs:linkcheck` → checks external links and writes
  `docs/01-indices/linkcheck-report.json`.
- `pnpm docs:build` → generates catalog, validates docs, and runs `mkdocs build --strict`.
- Navigation lives in `mkdocs.yml`; update it when adding new top-level docs.

## Automation & CI

- Pre-commit (see `.pre-commit-config.yaml`) enforces formatting, DocOps catalog generation, metadata
  validation, Markdownlint, and optional Vale.
- GitHub Actions workflow `.github/workflows/docs-check.yml` runs catalog generation, validation,
  Markdownlint, and MkDocs build for every PR/push.

## Need Help?

- Review `AGENTS.md` for workflows, commands, and DevOps/DocOps expectations.
- Use the DocOps checklists to ensure new repos or branches follow the same structure.
- When in doubt, add content under the numbered `docs/` tree and regenerate the catalog before
  opening a PR.

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on how to contribute.

## Code of Conduct

Please read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for our code of conduct.

## Security

Please read [SECURITY.md](./SECURITY.md) for security guidelines.

## License

AIDHA is licensed under the Apache License 2.0. See [LICENSE.md](./LICENSE.md) for more information.
