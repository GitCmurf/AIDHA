---
document_id: AIDHA-TESTING-082
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-10-29
title: Vitest 4.1.11 Compatibility Verification
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-082
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# Vitest 4.1.11 Compatibility Verification

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Record current-main compatibility evidence for the Vitest 4.1.11 update. | — | Draft | PR #25 |
| 0.2 | 2026-10-29 | Codex | Reassess complete current-main coverage after test prerequisites land. | — | Draft | PR 25; PR 47; PR 65 |
| 0.3 | 2026-10-29 | Codex | Qualify the complete supported-runtime suite and transformed mock. | — | Draft | PR 25 |

## Historical scope, 2026-10-18

This record covers Dependabot [PR #25](https://github.com/GitCmurf/AIDHA/pull/25), head
`5190109bb0e5e580f191c727ca4b93d811e85127`, applied to current `main`
`10124abd8009a810aa38180e66bb1a375742ff11` in the isolated `/tmp/aidha-052-vitest-review`
worktree. The PR changes 19 workspace development dependency declarations from
`vitest: ^4.1.6` to `^4.1.11` and updates `pnpm-lock.yaml`; it changes no application or test
source. The [Vitest 4.1.11 release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11)
is the upstream target.

The current-main email package dependency graph is preserved in the merged lockfile. Relative to the
PR lockfile, the merge adds current main's email parser graph (`mailparser` 3.9.40 and its
corresponding parser dependencies); this is the only non-Vitest graph reconciliation. The email
package's source dependency declarations match current main. The PR's Vitest changes are
development-only and do not change runtime dependencies.

The 19 workspace consumers are `aidha-config`, `phyla`, `reconditum`, and the `praecis` acquire,
CLI, core, decode, source, and YouTube packages. Each has a `test:ci` script. The root workspace
test command invokes the recursive `test:ci` scripts after its script-integrity and public-safety
checks.

## Historical verification, 2026-10-18

The proposed update is compatible when the frozen dependency graph installs, all workspace builds
and lint checks succeed, and the repository's script-integrity, public-safety and Vitest checks pass
on the current-main integration tree. Verification on 2026-10-18 produced:

- `pnpm install --frozen-lockfile` passed (exit 0; recorded in preparation evidence).
- `pnpm -r build` passed (exit 0).
- `pnpm -r lint` passed (exit 0).
- `node scripts/check-test-scripts.mjs` passed (exit 0).
- `node scripts/check-public-safety.mjs` passed (exit 0, elevated after the restricted sandbox
  denied its local `git` subprocess with `EPERM`).
- `node scripts/test-public-safety.mjs` passed (exit 0, elevated after the same sandbox
  restriction).
- `pnpm -r test:ci --exclude='**/real-client-config-isolation.test.ts'` passed (exit 0) across
  all 19 workspace consumers. The run reported 1,961 passed tests and 7 existing skipped tests.
  Across workspace summaries, 216 test files passed and one existing test file was skipped.
  The YouTube summary reported 109 passed test files and one skipped test file (110 total).
  Separately, `real-client-config-isolation.test.ts` was excluded from collection and is not
  included in those summaries. The 7 skipped tests were already skipped by the suite.
- `NODE_OPTIONS=--experimental-sqlite pnpm --filter @aidha/graph-backend test:ci` passed under
  the locally available Node 22.12.0 runtime with Vitest 4.1.11 (156 tests across 13 files).
  This verifies the recorded suite under the exact Node 22.12.0 runtime; no separate security or
  performance certification is implied.

The YouTube `real-client-config-isolation.test.ts` file is deliberately excluded because its native
network fallthrough is being fixed separately in PR #47. The exclusion is passed as an additional
Vitest `--exclude` glob through pnpm. This separately omitted file is distinct from the one
pre-existing skipped test file reported by Vitest. The excluded file is absent from collection
counts. This record does not claim that the omitted file passed or that the entire unfiltered root
test command passed. Re-run that file after the independent fix lands.

The complete command, exit, and output records are retained under
`/tmp/aidha-052-vitest-evidence/`. This compatibility result establishes test/build behavior for
the recorded dependency update and runtime; it does not establish a security audit or any broader
product behavior change.

## Current integration, 2026-10-29

The earlier evidence above remains historical. The refreshed branch integrates merged main
including PR 65, which builds the executable test prerequisites before Vitest, and PR 47,
which isolates the native fallback in the cookie configuration regression. An earlier local
run also hit the nested compiler setup timeout addressed by PR 65. Neither that run nor
the earlier coverage exclusions establish current compatibility.

The final integration must pass the complete repository test command without an added
exclusion, together with frozen installation, workspace build/lint, strict documentation
build and scoped DocOps. Preserve the root serial test orchestration and all existing
assertions, test budgets and skips. Scope includes the 19 development dependency declarations
and their lockfile graph, this evidence/navigation record, and the narrow legacy NLP
test-loader correction below. No application code or fixture data changes.

The update also refreshes development-only Vite/Rolldown dependencies, including Lightning
CSS, PostCSS, Nano ID, picomatch and optional native/WASM support packages. The complete
85-package production dependency closure is unchanged, including resolutions and package
records. All 19 manifests otherwise match the integration base.

The optional Rolldown WASM fallback now uses `@napi-rs/wasm-runtime` 1.2.4, whose engine range
excludes Node 22.12. Native Linux binding checks on that runtime do not validate this
optional fallback. The historical Node-floor result above cannot establish its compatibility.
The graph-backend package in that historical command is `packages/reconditum`.

## Supported-runtime fixture boundary

The complete Node 22.12.0 run exposed a legacy NLP mock that used CommonJS require to
load raw TypeScript. The same collection failure occurs on unchanged Vitest 4.1.6 from
main, so it is not introduced by the runner update. The fixture now loads through Vitest
using a normal module import; its data, NLP assertions and application code are unchanged.
The original failing run is retained, rather than counted as passing floor coverage.

A separate pipeline test exceeded its unchanged 15-second budget during the broad run.
The same case passes in a quiet focused control in less than one second of test execution.
That focused control alone did not clear the failed full-run boundary. The completed
supported-runtime qualification below closes it after the fixture correction. No timeout,
assertion or skip is relaxed.

Focused post-correction checks use the package-installed Vitest with
`run tests/nlp-utils.test.ts --maxWorkers=1`. All 74 NLP cases pass on official
Node 22.12.0 with `NODE_OPTIONS=--experimental-sqlite`, and on Node 22.21.1. The main
Vitest 4.1.6 control fails collection on Node 22.12.0 before the correction. The factory
retains the original default-only mock namespace, and a repository search finds no other
importer of this fixture. Fixture data and all test bodies remain unchanged; only the
loader, its explanatory comment and standard licence header change.

Before the loader correction, the complete `pnpm test` command passed all 19 Vitest
package suites on Node 22.21.1: 2,337 passed and nine existing skips, alongside the root
script/public-safety/semantic checks. That full-run result predates the loader correction;
it is supplemented by the focused current-runtime check above and does not replace the
complete supported-runtime qualification recorded below. Workspace build and lint also passed.

## Completed supported-runtime qualification, 2026-10-29

On integration base e5e5bdb, the corrected complete `pnpm test` command passes on official
Node 22.12.0 with its documented experimental SQLite flag. All 19 Vitest package suites
run without an added exclusion: 2,337 tests pass and nine existing tests are skipped.
The root script-integrity, public-safety and semantic checks also pass. Child commands use
the same selected Node runtime. This complete retry clears the earlier NLP collection
failure and pipeline timing boundary without changing test budgets, assertions or skips.

The Node 22.21.1 full-run result above predates the loader correction; the unchanged 74
NLP cases pass separately after it on that runtime. Hosted CI must check the final head.
The complete floor run exercises native Linux bindings; it does not validate the optional
WASM fallback or certify other platforms. Published package integrity, engine ranges and
the unchanged production dependency closure remain separate evidence from test results.

Native Claude review found no blocking patch defect, subject to the documented run gates.
Native CodeRabbit completed the 23-path dependency slice with zero findings, then the
two-file fixture/documentation correction with zero findings. Independent specification
and standards review found no remaining material defect. The review gates about the mock
namespace, shared fixture imports and focused runtime evidence are addressed explicitly.

The reviewed fixture loader is in
[NLP utilities tests](https://github.com/GitCmurf/AIDHA/blob/2f1960e94316d435e13dee886f22c38f384d96a1/packages/praecis/youtube/tests/nlp-utils.test.ts).
