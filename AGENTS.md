# Repository Guidelines

## Project Structure & Module Organization
- `docs/00-governance/gov-001-document-standards.md` captures metadata + Version History rules; every doc you touch must comply before review.
- Configuration lives in `~/.config/aidha/config.yaml` (user) or `./.aidha/config.yaml` (project); see `docs/60-devex/config-guide.md`.

## Dev Workflow & Commands
- `pnpm docs:serve` / `pnpm docs:build` — preview and validate the MkDocs site before opening a PR.

## Engineering Principles
- specification-led
- test-driven development
- modularised, reusable, separation of concerns
- recommend use of battle-tested open-source libraries/modules over 'reinventing the wheel'
- SOLID + DRY + KISS
- atomic unit of change is: tests + code + comments + docs
- all material code changes should be code-reviewed before commit
- follow professional 'git etiquette', including common commit messages and push only within an appropriate PR

## Coding Style & Naming Conventions
- Bash scripts use 4-space indentation, `set -euo pipefail`, and descriptive function names; prefer long-form flags for readability.
- Branches and spec folders must follow `NNN-short-name` (lowercase, dashed) to remain discoverable by the automation pipeline.
- When new languages appear, commit formatter configs (Prettier, Black, gofmt, etc.) and record the invocation inside the spec’s README/PLAN.

## Test-Driven Development Guidelines
- Begin every task with a failing test (Bats/shunit2 for Bash, Jest/Go test/etc. as stacks expand).
- Local red-green cycle: `bash -n script.sh`, `shellcheck script.sh`, then the spec’s tests; CI should mirror `lint → unit → integration`.
- Document acceptance criteria and link to the test file so reviewers see how behavior is protected.

## DevOps & DocOps Best Practices
- Keep branches small (≈2 days) and push frequently so CI, code review, and preview docs stay current.
- Store deployment manifests, Dockerfiles, and runbooks next to the feature they support, updating the README in the same PR.
- After each merge train, rerun `update-agent-context`, prune stale specs, and re-sync templates—DocOps deserves the same cadence as CI/CD.
- For any PRD/ADR/FDD/runbook/devex/README/etc., copy the metadata + Version History blocks from `docs/00-governance/gov-001-document-standards.md` and update them in the same PR as the code change.
- Never merge without `pnpm docs:build` succeeding; the MkDocs site is the canonical artifact reviewers use.
- Use `scripts/meminit-check.mjs <path-or-glob>` for scoped DocOps checks; use `meminit check --root .` for full repo checks.

## Initial Toolchain Targets
- **Graph Knowledge Backend (`packages/reconditum/`)**: exposes cognition graph APIs, JSON-LD export, and graph contract tests.
- **Taxonomy & Metadata (`packages/phyla/`)**: manages classification schema, responsibilities/projects ontology, and AI retrieval metadata.
- **YouTube Ingestion Engine (`packages/praecis/youtube/`)**: pulls playlist transcripts, classifies via the taxonomy, applies metadata, summarizes insights, and publishes commentary.

Each package requires: dedicated PRD/ADR, doc-complete quickstart/runbook, and CI coverage (unit + graph-contract + DocOps checks) before merge.

## Commit & PR Expectations
- Write a single imperative summary ≤72 characters, with conventional-commit prefixing.
- PRs must link the initiating spec, list the commands/tests (plus CI job links) that passed, include screenshots/logs for UX changes, and confirm that docs stayed in sync.
