---
document_id: AIDHA-TESTING-095
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-29
title: Build Before Executable Tests
type: TESTING
docops_version: '2.0'
area: CLI
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-095
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# Build Before Executable Tests

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-29 | Codex | Separate compilation from executable-test assertions. | — | Draft | AIDHA-PLAN-015 |

## Problem and scope

The YouTube CLI memory-database test compiles five workspace packages inside a setup hook.
That compiler subprocess has a 120-second deadline. During branch verification, both the full
suite and a quiet single-file control exhausted it before reaching the functional assertion.
A separate clean-main control passed. The fixture is unchanged between main and the candidate;
these results show that compilation duration can determine whether the test runs.

Move the existing runtime build prerequisite into the package test commands. The current CI
pipeline already builds the workspace before testing. Keep that pipeline and every functional
CLI assertion unchanged, including subprocess deadlines and the memory-database reopen check.
The root test and test:full commands dispatch package tests serially so this package-local prerequisite
cannot rewrite shared build output while another package is reading it. No production source,
dependency version, compiler option or provider behaviour changes.

## Acceptance criteria

- The test, test:ci, test:full and test:watch commands build the YouTube package and its
  workspace dependencies before starting Vitest.
- A failed build stops the command, preserves its nonzero status and never starts Vitest.
- A filter that matches no runtime package fails instead of starting tests against old output.
- Selected test arguments reach Vitest without being forwarded to the build prerequisite.
- The executable test still ingests a synthetic video into memory without creating a database
  file; a subsequent process cannot recover that source and creates no transcript output.
- Both root test and test:full dispatch use one workspace at a time; builds finish before sibling tests
  may read the shared output. All existing test cases and skips remain selected.

## Verification and use

The command-order regression exercises the actual package commands with isolated local
executables that expand the actual manifest helper, record compiler arguments and invocation
order, and simulate only the deepest build success or failure. A copied-manifest control
replaces the helper with a successful no-op: the original harness passed that control, while
the strengthened harness rejects it. The pinned pnpm 9.12.0 also returns nonzero for an unknown
filter with --fail-if-no-match; without that flag, the same unknown filter returned success.
The public CLI memory-database acceptance exercises the actual compiled executable.

For a complete run, use:

~~~bash
pnpm --filter @aidha/ingestion-youtube test:ci
~~~

For a direct focused Vitest invocation, first build its runtime:

~~~bash
pnpm --filter @aidha/ingestion-youtube run build:test-runtime
pnpm --filter @aidha/ingestion-youtube exec vitest run tests/cli-memory-database.test.ts
~~~

Watch mode builds once at startup. Restart its package command after editing code used by the
compiled CLI so the executable under test reflects that edit. Source-only unit tests continue
to use Vitest's normal watch behaviour.

The command harness targets the Linux CI runner and uses synthetic temporary files. It invokes
no model or network service. A full build and package suite remain separate evidence from the
small command-order regression.

The root test command delegates to package test:ci commands, and the checked CI workflow
builds before that root command. Direct Vitest or IDE invocations require the explicit
preparatory build above; they do not independently certify that compiled output is current.

Ad hoc recursive package-test invocations also require --workspace-concurrency=1 when they
may rebuild shared runtime output. The supported root commands already supply that option.
