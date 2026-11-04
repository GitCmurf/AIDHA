---
document_id: AIDHA-TESTING-103
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-11-04
title: Vitest 4.1.12 Dependency Maintenance
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-103
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-11-04
> **Type:** TESTING

# Vitest 4.1.12 Dependency Maintenance

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-04 | Codex | Qualify the coordinated Vitest security patch through existing module mocks, spies and source-map consumers | — | Draft | Owner autonomous progress request |

## Problem and scope

Update the 19 existing Vitest development requirements from `^4.1.11` to
`^4.1.12`, then lock Vitest and its seven regular `@vitest/*` dependencies to
4.1.12. The [official release][release] backports two mocker fixes. Their
advisories establish the affected baseline before the dependency change:

| Advisory | Severity | Affected 4.x versions | First fixed 4.x release |
| --- | --- | --- | --- |
| [GHSA-qxg6-89mg-rqv8][manual]: unauthenticated manual-mock code injection | Moderate | `>=4.0.0 <4.1.12` | 4.1.12 |
| [GHSA-xp26-3454-mjgp][redirect]: Windows backslash traversal in redirect mocks | Moderate | `>=4.1.11 <4.1.12` | 4.1.12 |

The manual-mock advisory's complete affected range starts at `2.1.0-beta.7`.
Both advisories affect the installed 4.1.11 baseline. They concern the mocker
plugin's development-server registration path. All 19 AIDHA Vitest configurations
use the Node environment; this check does not establish a remotely reachable
browser mock server in AIDHA.

Fresh repository alert metadata after main `da0bb2c` identifies alerts 49 and 58
as these two open mocker findings. Selecting 4.1.12 removes both affected package
ranges. Actual alert closure requires a fresh repository check after merge; the
three separate Nodemailer findings are outside this change.

## Published contracts and exact resolution

The published registry manifests, read with the existing npm CLI and checked
against the tagged [Vitest][vitest-package] and [mocker][mocker-package]
declarations, confirm:

- `vitest@4.1.12` requires exact 4.1.12 regular dependencies on `@vitest/expect`,
  `mocker`, `pretty-format`, `runner`, `snapshot`, `spy` and `utils`.
- `@vitest/mocker@4.1.12` requires exact `@vitest/spy@4.1.12`, plus
  `estree-walker: ^3.0.3` and `magic-string: ^0.30.21`.
- Vitest's regular and mandatory peer Vite ranges remain
  `^6.0.0 || ^7.0.0 || ^8.0.0`. Mocker has the same optional Vite peer range and
  optional `msw: ^2.4.9` peer. No optional provider is added.
- Vitest's Node engine range remains `^20.0.0 || ^22.0.0 || >=24.0.0`.
  Mocker declares no engine range. These declarations are dependency contracts,
  not runtime-execution evidence.

Patch the parent and family together rather than override the exact mocker edge
in isolation. Use pnpm 9.12.0 `install`, preserving its generated package records
and upstream contracts. Temporarily select the exact parent 4.1.12 if needed,
then restore the final caret requirements and regenerate importer specifiers
before frozen installation. Do not use a broad dependency update.

Compare the final lockfile canonically with immutable main
`da0bb2ccb7ead7c758245fa192819bcd759bf659`. Exclude only the eight changed family
records and normalise their explicit version contexts before comparing the other
packages, snapshots and importers. Every unrelated resolution and contract must
remain equal. In particular, retain Vite 8.1.6, PostCSS 8.5.28,
source-map-js 1.2.2, fast-uri 3.1.9 and the existing root override bytes.
The 19 manifest diffs must contain only the Vitest floor changes.

Read the installed package manifests through the actual workspace consumer to
confirm that registry resolution and the installed archive agree. Frozen
strict-peer installation must accept the final caret manifests and lockfile.

## Acceptance and verification

Use these existing behaviour checks:

| Consumer | Protected behaviour |
| --- | --- |
| [Graph export output][export-tests] | Hoisted asynchronous module factory, `importOriginal`, `importActual`, mocked filesystem failure and cleanup precedence |
| [NLP utilities][nlp-tests] | TypeScript fixture transformation and its default-only mocked module namespace |
| [Client configuration isolation][isolation-tests] | Fetch spy restoration and separate client configuration, with mocked HTTP and a guaranteed unavailable native fallback |
| [Package-script guards][script-tests] | Existing exhaustive default test dispatch and required runtime-build prerequisites |
| [Source-map compatibility][map-tests] | PostCSS transforms CSS while preserving original mapped positions and source text through the installed toolchain |

Commands from the repository root:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm -r --filter @aidha/ingestion-youtube... --fail-if-no-match --workspace-concurrency=1 build
pnpm -r --filter @aidha/config --filter @aidha/graph-backend --filter @aidha/taxonomy --filter @aidha/praecis-core --fail-if-no-match --workspace-concurrency=1 lint
pnpm --filter @aidha/praecis-cli --fail-if-no-match exec vitest run tests/graph-export-output.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @aidha/ingestion-youtube --fail-if-no-match exec vitest run tests/nlp-utils.test.ts tests/real-client-config-isolation.test.ts tests/package-scripts.test.ts --maxWorkers=1 --no-file-parallelism
pnpm test:source-map
node scripts/meminit-check.mjs docs/55-testing/testing-103-vitest-maintenance.md
pnpm docs:build
```

Frozen strict-peer installation passes. Reading installed manifests from all 19
workspaces confirms the 4.1.12 parent and its seven exact 4.1.12 regular siblings.
Canonical comparison confirms 169 unrelated package records and 169 unrelated
snapshots are equal. The 19 importer entries differ only at the parent floor and
version, preserving their peer contexts; each package manifest differs only at
the Vitest floor. Root manifest bytes and other top-level lock metadata match the
immutable base.

The five-package build command matched five projects. Config, graph backend,
taxonomy and core builds completed; the final YouTube compiler received SIGTERM
when the command reached its 300-second process budget, without a TypeScript
diagnostic. The cause is not established. The local YouTube build remains
unverified and its lint is not run. Do not count partially emitted files as a
completed build or retry it with altered test or compiler settings.

The four prerequisite package lints pass. All 89 selected cases pass: nine graph
export cases, 74 NLP cases, one client-isolation case, four package-script guards
and one source-map case. The Vitest runs use 4.1.12, one worker and serial files;
the source-map case uses Node's test runner through the installed dependency chain.
All existing assertions, skips and timeouts are unchanged. The full local workspace
suite is not repeated. Unchanged default full hosted CI must build, lint and test
all 19 packages, including YouTube, and reporting review bots must be green before
merge.

Local checks use Node 24.22.2 and native Linux x64 bindings. The hosted workflow
uses Ubuntu and Node 22. Neither package engine declarations nor these checks
establish exact minimum-runtime, Windows or optional WASM execution coverage.
The retained wasm-runtime 1.2.4 already excludes Node 22.12 in its engine range;
that baseline limitation remains as recorded in [AIDHA-TESTING-100][vite-testing].

[release]: https://github.com/vitest-dev/vitest/releases/tag/v4.1.12
[vitest-package]: https://github.com/vitest-dev/vitest/blob/v4.1.12/packages/vitest/package.json
[mocker-package]: https://github.com/vitest-dev/vitest/blob/v4.1.12/packages/mocker/package.json
[manual]: https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8
[redirect]: https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp
[export-tests]: https://github.com/GitCmurf/AIDHA/blob/da0bb2ccb7ead7c758245fa192819bcd759bf659/packages/praecis/cli/tests/graph-export-output.test.ts
[nlp-tests]: https://github.com/GitCmurf/AIDHA/blob/da0bb2ccb7ead7c758245fa192819bcd759bf659/packages/praecis/youtube/tests/nlp-utils.test.ts
[isolation-tests]: https://github.com/GitCmurf/AIDHA/blob/da0bb2ccb7ead7c758245fa192819bcd759bf659/packages/praecis/youtube/tests/real-client-config-isolation.test.ts
[script-tests]: https://github.com/GitCmurf/AIDHA/blob/da0bb2ccb7ead7c758245fa192819bcd759bf659/packages/praecis/youtube/tests/package-scripts.test.ts
[map-tests]: https://github.com/GitCmurf/AIDHA/blob/da0bb2ccb7ead7c758245fa192819bcd759bf659/scripts/security/source-map-compatibility.test.mjs
[vite-testing]: testing-100-vite-toolchain-maintenance.md
