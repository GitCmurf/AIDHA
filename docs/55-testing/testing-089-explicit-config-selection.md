---
document_id: AIDHA-TESTING-089
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Explicit Config Selection
type: TESTING
docops_version: '2.0'
area: CLI
related_ids: [AIDHA-GUIDE-005]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-089
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Explicit Config Selection

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify explicit config selection and safe fallback regressions. | — | Draft | AIDHA-GUIDE-005 |

## Scope

When a caller explicitly selects a config file with `--config` or `AIDHA_CONFIG`, a missing file
must remain an error. The shared resolver must not turn that error into a successful default
configuration. The existing zero-config behavior remains available when no file is explicitly
selected and discovery finds no file. A valid `--config` path overrides `AIDHA_CONFIG`; a valid
config without `--profile` uses its `default_profile`.

This contract covers the resolver API and the public `config explain db` command. It does not
change config search locations, path interpretation, `:memory:` behavior, profiles, model defaults,
authentication, or provider calls. A config or profile flag with no value is an error instead of an
implicit request to use defaults.

## Acceptance

The CLI config tests in `packages/praecis/cli/tests/cli.test.ts` use temporary config paths and
isolated `HOME`, `XDG_CONFIG_HOME`, and working directories. They verify:

- Missing explicit `--config` and missing `AIDHA_CONFIG` both return resolver errors and cause
  `config explain db` to exit nonzero without printing fallback values.
- A valid CLI config overrides a missing environment-selected path and selects the file's
  `default_profile`.
- With no explicit selector and no discovered file, resolution still succeeds with hardcoded
  defaults.
- Bare `--config` and `--profile` options fail before config resolution.

No test reads user config, opens a graph database, or invokes an external provider.

## Verification

Run the dependency closure before the CLI tests:

```bash
pnpm --filter @aidha/praecis-cli... build
pnpm --filter @aidha/praecis-cli exec vitest run tests/cli.test.ts
pnpm --filter @aidha/praecis-cli lint
node scripts/meminit-check.mjs docs/55-testing/testing-089-explicit-config-selection.md docs/60-devex/config-guide.md
pnpm docs:build
```

These commands specify the intended checks. Actual results and any environment limits belong in
the change's review evidence.
