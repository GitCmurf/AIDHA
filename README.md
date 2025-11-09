# AIDHA Workspace

This repository hosts automation templates and prompts for Specify-style feature development. Start by reading `AGENTS.md` for workflow guidance, `docs/Document_Standards.md` for DocOps conventions, and the `.specify/templates/` directory for SpecKit source files.

## Quick Start
1. Run `bash .specify/scripts/bash/check-prerequisites.sh` to verify tooling.
2. Create a spec branch with `bash .specify/scripts/bash/create-new-feature.sh "Describe feature" --short-name feature-name`.
3. Populate the generated `specs/<number>-<short-name>/` folder before implementing code.

## Repository Hygiene & DocOps
- `.gitignore` tracks common build artifacts, language dependencies, and spec-specific outputs.
- `.gitattributes` enforces LF line endings and provides better diffs for Markdown and shell scripts.
- `docs/Document_Standards.md` defines required metadata blocks, version tables, and document IDs; every PRD/ADR/FDD/runbook must follow it.
- CI should run `pnpm lint`, `pnpm test`, and docs/quickstart verification to mirror the DevOps + DocOps coupling defined in `AGENTS.md` and the Constitution.

## Initial Toolchain Focus
The first three interdependent tools share the same DocOps gates:

1. **Graph Knowledge Backend (`packages/graph-backend/`)** – a pnpm workspace package exposing the personal cognition graph API plus JSON-LD export and contract tests.
2. **Knowledge Taxonomy & Metadata (`packages/taxonomy/`)** – classification schemas, ontology definitions, and governance for responsibilities/projects with AI-friendly metadata.
3. **Ingestion Engine (`packages/ingestion-youtube/`)** – pipeline that processes YouTube playlists, captures transcripts, classifies against the taxonomy, enriches metadata, summarizes insights, and emits editorial commentary.

Each package requires: (a) PRD + ADR using the metadata/Version History template, (b) TDD-first implementation with coverage ≥80%, (c) DocOps artifacts (quickstart, runbook, prompts) tracked alongside code.
