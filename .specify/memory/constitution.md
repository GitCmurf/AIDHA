<!--
Sync Impact Report
Version change: 0.0.0 → 1.0.0
Modified principles:
- Graph-Native Knowledge Fabric
- AI-Augmented Co-Design
- Test-Driven Delivery
- DevOps & DocOps as Product Work
- Modular pnpm Monorepo Stewardship
Added sections:
- Architecture & Stack Guardrails
- Workflow, Review & Quality Gates
Removed sections:
- None
Templates requiring updates:
- ✅ .specify/templates/plan-template.md
- ✅ .specify/templates/spec-template.md
- ✅ .specify/templates/tasks-template.md
Follow-up TODOs:
- None
-->
# AIDHA Workspace Constitution

## Core Principles

### I. Graph-Native Knowledge Fabric
Every feature MUST extend a single shared, graph-based personal knowledge management (PKM) model.
Specifications SHALL document new nodes, relationships, and ontology changes before code exists.
All persisted data uses immutable IDs, human-readable labels, and provenance metadata so AI agents
can traverse, explain, and refactor knowledge safely.

### II. AI-Augmented Co-Design
All components MUST expose deterministic interfaces (CLI or API) plus structured prompts so AI
agents can plan, test, and document outcomes. Prompt files live beside the code they influence
(e.g., `packages/<pkg>/prompts/`), include rationale, and ship with automated evaluations. Human
reviewers verify that AI-generated outputs are reproducible from version-controlled artifacts.

### III. Test-Driven Delivery (Non-Negotiable)
Work begins with failing automated tests. Red–green–refactor cycles are enforced per package, and
no code merges without: unit tests, graph-contract tests, and DocOps verification (quickstart or
README updates). Minimum coverage targets start at 80% per workspace and increase with maturity;
exceptions require a written waiver in the spec.

### IV. DevOps & DocOps as Product Work
CI/CD pipelines MUST mirror local commands (`pnpm lint`, `pnpm test`, `pnpm build`). Every change
updates corresponding docs in the same PR: specs, plans, runbooks, and AGENT summaries. Operational
insights (metrics, alerts, runbooks) live under `packages/<pkg>/ops/` and are versioned alongside
code. Deployments are “documentation deploys”: pipeline fails if docs or quickstarts fall behind the
implemented behavior.

### V. Modular pnpm Monorepo Stewardship
The repository is a pnpm workspace-first monorepo. Each package publishes a clear API surface,
Typedoc/Storybook-like docs, and uses semantic version ranges internally. Shared utilities start as
packages under `packages/` with explicit ownership. Cross-package imports MUST respect dependency
rules defined in the workspace manifest; circular graphs are forbidden.

## Architecture & Stack Guardrails
- **Stack**: Node.js LTS + pnpm, TypeScript preferred; additional languages require RFC approval.
- **Knowledge graph storage**: Model schemas in `docs/graph/` (Typescript interfaces + Mermaid
  diagrams). Implementations MUST support graph queries (e.g., Neo4j, Memgraph, RDF stores) and a
  JSON-LD export for AI ingestion.
- **AI integration**: Provide adapters in `packages/agents/` that describe IO contracts, test
  doubles, and guardrails for every AI tool used in delivery.
- **Observability**: Structured logs (JSON), trace IDs propagated through graph operations, and
  metrics describing node/edge mutations per release.
- **Security**: Secrets managed via `.env.example` templates plus Vault-compatible loaders; no
  inline credentials.

## Workflow, Review & Quality Gates
1. **Phase 0 – Constitution Check**: Feature plans must confirm graph impact, AI touchpoints, test
   strategy, DocOps updates, and pnpm workspace changes before research proceeds.
2. **Phase 1 – Research & Design**: Produce graph schemas, workspace impact matrix (package adds,
   renames, or removals), and DocOps outline (files to update, automation to regenerate).
3. **Phase 2 – Implementation**: Follow TDD; each commit runs `pnpm lint:test` locally before push.
4. **Phase 3 – Review**: PR template links specs, lists executed commands, includes coverage report,
   pnpm workspace diff, and documentation diff screenshots when relevant.
5. **Phase 4 – Release**: Tag packages via `pnpm changeset` (or equivalent) and attach doc deploy
   proof (rendered quickstart or Storybook link). Production incidents trigger a retro that references
   this constitution.

## Governance
- This constitution supersedes conflicting docs. Amendments require RFC, approval from two maintainers,
  and updates to affected templates (plan/spec/tasks/checklists/agents).
- `docs/Document_Standards.md` defines operational DocOps policy; any new document lacking the
  metadata + Version History block fails review.
- Semantic versioning governs constitutional updates: MAJOR for breaking principle changes, MINOR for
  new principles/sections, PATCH for clarifications.
- Compliance is checked during plan reviews and CI; violations block merge until resolved or waived by
  maintainers with documented mitigation.
- Any feature touching AI orchestration or the knowledge graph must appoint a steward responsible for
  monitoring production metrics and documentation freshness until the next release.

**Version**: 1.0.0 | **Ratified**: 2025-11-09 | **Last Amended**: 2025-11-09
