# @aidha/graph-backend

This pnpm workspace package hosts the personal cognition graph backend. Key requirements:

- Implements the graph schema + APIs defined in `docs/10-prd/prd-001-graph-database.md`
  and associated ADRs.
- Provides deterministic JSON-LD exports and graph contract tests.
- Exposes an upsert-first `GraphStore` with SQLite and in-memory implementations.
- Ships DocOps assets alongside code (`docs/quickstart.md`, `ops/runbook.md`, prompts)
  and keeps them synchronized with the central `docs/` tree.

## Structure

```
src/        # graph services, resolvers, schema adapters
tests/      # unit + contract tests (TDD-first)
docs/       # package-scoped quickstarts following Document Standards
ops/        # runbooks, SLOs, dashboards
prompts/    # AI prompt suites + evaluations
```

Follow `docs/60-devex/initial-tools-roadmap.md` for the implementation plan.
