---
document_id: AIDHA-TESTING-099
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-11-03
title: Source Map Dependency Maintenance
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-099
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-11-03
> **Type:** TESTING

# Source Map Dependency Maintenance

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-03 | Codex | Qualify the compatible source-map-js patch through its existing PostCSS consumer | — | Draft | Owner autonomous progress request |
| 0.2 | 2026-11-03 | Codex | Pin the consumer regression to its reviewed source and record the focused gate | — | Draft | b4db724 |

## Problem and scope

GitHub Dependabot alert 43 identifies `source-map-js` 1.2.1 in `pnpm-lock.yaml`
as affected by [GHSA-68fv-2mgg-jv7q][advisory].
The advisory covers denial of service when consuming crafted indexed source maps.
The first fixed release is 1.2.2; the maintainer's
[release notes][release] and [merged fix][upstream-fix] describe the change.

The installed path is workspace Vitest 4.1.11 → Vite 8.0.12 → PostCSS 8.5.28 →
source-map-js. PostCSS already permits the patched version through `^1.2.1`.
Refresh only that transitive package, its registry integrity and its lockfile
references. Retain all other dependency resolutions and manifest requirements.
No direct dependency or override is needed.

These libraries serve the development test toolchain. Static inspection found no
direct application imports of Vite, PostCSS or source-map-js, and did not establish
an untrusted application input reaching the affected consumer. This maintenance
does not validate an exploit, change application behaviour, activate services or
resolve the separate Vite and Node-runtime work.

## Acceptance criteria

- The pre-change official alert identifies the selected 1.2.1 dependency as affected.
  After frozen installation, resolution through the actual Vitest/Vite/PostCSS
  chain selects 1.2.2, outside the advisory's affected range `>=1.0.0 <1.2.2`.
- The package-manager-generated lockfile change contains only the source-map-js
  package, integrity, snapshot and existing PostCSS dependency edge. No unrelated
  dependency update, direct dependency or override is retained.
- The [benign consumer regression][consumer-regression]
  transforms mapped CSS through the installed PostCSS and source-map-js packages.
  It checks the changed CSS and retained original filename, line, column and source
  text. It uses a small valid source map and does not recreate a denial-of-service
  payload. This regression is part of the normal `pnpm test` command.
- Existing workspace tests, builds and lint pass against the frozen updated lock.
  Strict documentation build and scoped DocOps checks pass.

The advisory is the independent failing dependency baseline. The compatibility
regression is expected to pass on both versions: it checks normal consumer
behaviour rather than duplicating lockfile constants or testing upstream's exploit.
Local dependency resolution does not prove that GitHub has closed the alert;
verify its state after a reviewed merge.

## Verification

Local checks use Node 24.22.2 and pnpm 9.12.0. Frozen installation, the benign
consumer check, all 19 package builds and lints, scoped DocOps and strict docs
build pass. The consumer resolves PostCSS 8.5.28 and source-map-js 1.2.2. The patched
dependency audit no longer reports source-map-js; 16 unrelated findings remain
(one high, twelve moderate and three low), so the overall audit still exits nonzero.

The original default test run stopped after two unchanged SQLite snapshot tests
exceeded their existing five-second timeout. The unchanged isolated snapshot file
then passed thirteen tests with one existing skip; the graph suite passed 169 tests
with one skip using a single worker. Configuration (366), taxonomy (28), core (484)
and seven smaller package suites passed. The subsequent YouTube run passed 1,161
tests with seven skips and two failures: an existing public-process test timed out,
and the root command guard needed the newly added `test:source-map` step. The guard
expectation is corrected without changing serial or exhaustive dispatch.
The corrected four-case command guard and the benign consumer check both pass.

The later six source packages and CLI package were not reached. No test timeout
or security control is relaxed. Hosted default full CI and actual reporting review
bots must pass before merging; these partial local results do not replace that gate.

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm test:source-map
pnpm build
pnpm lint
pnpm test
node scripts/meminit-check.mjs docs/55-testing/testing-099-source-map-maintenance.md
pnpm docs:build
```

Generate the candidate lockfile with
`pnpm update --recursive --depth Infinity --lockfile-only source-map-js@1.2.2`.
Inspect its diff and retain only the source-map-js entries; pnpm can also refresh
unrelated permitted transitive packages. Re-run frozen installation on the narrowed
lockfile before accepting it.

[consumer-regression]: https://github.com/GitCmurf/AIDHA/blob/b4db724e6efb1f2b92de55436225e1317dab7ead/scripts/security/source-map-compatibility.test.mjs
[advisory]: https://github.com/advisories/GHSA-68fv-2mgg-jv7q
[release]: https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2
[upstream-fix]: https://github.com/7rulnik/source-map-js/pull/79
