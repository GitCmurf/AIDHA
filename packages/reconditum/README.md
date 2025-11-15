# @aidha/graph-backend

This pnpm workspace package will host the personal cognition graph backend. Key requirements:

- Implements the graph schema + APIs defined in `docs/10-prd/GRAPH-PRD.md` and associated ADRs.
- Provides JSON-LD exports, deterministic CLI/HTTP entrypoints, and graph-contract tests.
- Ships DocOps assets alongside code (`docs/quickstart.md`, `ops/runbook.md`, prompts) and keeps them
  synchronized with the central `docs/` tree.

## Structure

```
src/        # graph services, resolvers, schema adapters
tests/      # unit + contract tests (TDD-first)
docs/       # package-scoped quickstarts following Document Standards
ops/        # runbooks, SLOs, dashboards
prompts/    # AI prompt suites + evaluations
```

Follow `docs/60-devex/Initial_Tools_Roadmap.md` for the implementation plan.
