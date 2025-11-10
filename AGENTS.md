# Repository Guidelines

## Project Structure & Module Organization
- `.specify/scripts/bash/` holds scaffolding, plan sync, and guardrails; keep scripts Bash-only so beginners can audit them quickly.
- `.specify/templates/` is the DocOps source—edit templates first, then regenerate plans, tasks, or summaries.
- `docs/00-governance/Document_Standards.md` captures metadata + Version History rules; every doc you touch must comply before review.
- `.codex/prompts/` stores conversational modules; document purpose inline so trainees learn by example.
- Feature work lives in `specs/<number>-<short-name>/` with `src/`, `tests/`, and `README.md`; promote reusable code/tests into top-level `src/` and `tests/` after review.

## Dev Workflow & Commands
- `bash .specify/scripts/bash/check-prerequisites.sh` — confirms git, jq, shellcheck, and other required CLIs.
- `bash .specify/scripts/bash/create-new-feature.sh "Add payments" --short-name payments` — spins up the numbered spec folder plus matching branch.
- `bash .specify/scripts/bash/setup-plan.sh specs/101-payments` — seeds PLAN/TASK docs so requirements and test ideas exist before coding.
- `bash .specify/scripts/bash/update-agent-context.sh` — refreshes AGENT summaries; run before every PR to deploy documentation with the code.
- `pnpm docs:serve` / `pnpm docs:build` — preview and validate the MkDocs site before opening a PR.

## Coding Style & Naming Conventions
- Bash scripts use 4-space indentation, `set -euo pipefail`, and descriptive function names; prefer long-form flags for readability.
- Branches and spec folders must follow `NNN-short-name` (lowercase, dashed) to remain discoverable by the automation pipeline.
- When new languages appear, commit formatter configs (Prettier, Black, gofmt, etc.) and record the invocation inside the spec’s README/PLAN.

## Test-Driven Development Guidelines
- Begin every task with a failing test in `specs/<id>/tests/` (Bats/shunit2 for Bash, Jest/Go test/etc. as stacks expand).
- Local red-green cycle: `bash -n script.sh`, `shellcheck script.sh`, then the spec’s tests; CI should mirror `lint → unit → integration`.
- Document acceptance criteria and link to the test file inside PLAN.md so reviewers see how behavior is protected.

## DevOps & DocOps Best Practices
- Keep branches small (≈2 days) and push frequently so CI, code review, and preview docs stay current.
- Store deployment manifests, Dockerfiles, and runbooks next to the feature they support, updating the spec README in the same PR.
- After each merge train, rerun `update-agent-context`, prune stale specs, and re-sync templates—DocOps deserves the same cadence as CI/CD.
- For any PRD/ADR/FDD/runbook, copy the metadata + Version History blocks from `docs/00-governance/Document_Standards.md` and update them in the same PR as the code change.
- Never merge without `pnpm docs:build` succeeding; the MkDocs site is the canonical artifact reviewers use.

## Initial Toolchain Targets
- **Graph Knowledge Backend (`packages/graph-backend/`)**: exposes cognition graph APIs, JSON-LD export, and graph contract tests.
- **Taxonomy & Metadata (`packages/taxonomy/`)**: manages classification schema, responsibilities/projects ontology, and AI retrieval metadata.
- **YouTube Ingestion Engine (`packages/ingestion-youtube/`)**: pulls playlist transcripts, classifies via the taxonomy, applies metadata, summarizes insights, and publishes commentary.

Each package requires: dedicated PRD/ADR, doc-complete quickstart/runbook, and CI coverage (unit + graph-contract + DocOps checks) before merge.

## Commit & PR Expectations
- Write a single imperative summary ≤72 characters, optionally prefixed with the spec number (`123: wire payment plan`).
- Branch names must match spec folders, ensuring release automation and documentation roll-ups can infer ownership.
- PRs must link the initiating spec, list the commands/tests (plus CI job links) that passed, include screenshots/logs for UX changes, and confirm that docs stayed in sync.
