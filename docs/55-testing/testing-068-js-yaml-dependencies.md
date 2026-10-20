---
document_id: AIDHA-TESTING-068
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-20
title: Patched JS-YAML Dependency Paths
type: TESTING
docops_version: '2.0'
area: CLI
related_ids: [AIDHA-PLAN-015]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-068
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-20
> **Type:** TESTING

# Patched JS-YAML Dependency Paths

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify compatible YAML dependency resolution and bounded merge-work regression. | — | Draft | AIDHA-PLAN-015; PR 26 |
| 0.2 | 2026-10-20 | Codex | Refresh on integrated main; preserve Fast URI and registration exports; date historical evidence. | — | Draft | AIDHA-PLAN-015; PR 26 |

## Scope and call sites

The YouTube package raises its direct `js-yaml` floor from `^4.1.1` to `^4.3.2`.
The lockfile resolves every installed copy through these existing compatible paths:

| Path | Parent version / allowed range | Resolved JS-YAML |
| --- | --- | --- |
| YouTube CLI | Direct `^4.3.2` | 4.3.2 |
| Configuration type generator | `json-schema-to-typescript` 15.0.4, `^4.1.0` | 4.3.2 |
| Generator reference parser | `@apidevtools/json-schema-ref-parser` 11.9.3, `^4.1.0` | 4.3.2 |

No override or parent API migration is required. Non-YAML lockfile objects stay unchanged.
The selected package integrity comes from the package manager's registry resolution;
a frozen offline install and installed-path checks validate the final isolated graph.

Production `config show`, object-valued `config get` and profile-diff output use `dump`.
The config loader and alias-preserving writer use the separate `yaml` 2.9.0 library,
which this change does not update. JS-YAML `load` appears in CLI tests and the development
schema-generator dependency chain. The checked-in generation command reads the controlled
JSON schema. No untrusted production JS-YAML parsing path is established by this work.

## Advisory floors

The GitHub dependency-alert snapshot on 2026-10-20 has four open JS-YAML advisories.
Their patched 4.x floors are covered by 4.3.2; version coverage does not establish application
reachability or close GitHub alerts before the change is merged and re-audited.

| Advisory | Patched 4.x floor | Boundary |
| --- | --- | --- |
| [GHSA-h67p-54hq-rp68][repeated-alias] | 4.2.0 | Repeated aliases in merge handling |
| [GHSA-52cp-r559-cp3m][merge-chains] | 4.3.0 | Merge-key chains and CPU work |
| [GHSA-5p4m-2wfm-xmqj][ordered-map] | 4.3.1 | Ordered-map duplicate lookup complexity |
| [GHSA-2883-xcg3-v3hh][empty-merges] | 4.3.2 | Empty merge sources consume work budget |

[repeated-alias]: https://github.com/advisories/GHSA-h67p-54hq-rp68
[merge-chains]: https://github.com/advisories/GHSA-52cp-r559-cp3m
[ordered-map]: https://github.com/advisories/GHSA-5p4m-2wfm-xmqj
[empty-merges]: https://github.com/advisories/GHSA-2883-xcg3-v3hh

## Acceptance and regression

[The bounded regression][regression] merges four empty mapping sources. A work cap of three
must reject it with the merge-budget diagnostic; a cap of four must parse the expected object
and retain its ordinary scalar. Baseline 4.1.1 ignores the cap: one test fails and the positive
control passes. With 4.3.2, both pass. The fixture contains four empty mappings, not a large
CPU-exhaustion payload, and has no timing assertion. The new option is used only in this
library-level test; no application parsing policy is added.

Existing configuration and CLI suites protect parsing, alias-preserving writes, YAML output
and secret redaction. The actual configuration type generator must succeed without changing
its checked-in generated files. Lint, dependency/CLI builds and the documentation checks must
pass before the refreshed PR is offered for merge. Real configuration or email is not used.

[regression]: https://github.com/GitCmurf/AIDHA/blob/b6ed449ed084832c9223746ecd294d1f1b8b6cb7/packages/praecis/youtube/tests/js-yaml-maintenance.test.ts

Local acceptance excludes `tests/real-client-config-isolation.test.ts` from the YouTube
package because its real-client fallback paths can attempt network access. That fixture
provides no coverage in this local run; it is unchanged by this dependency update.

Run from the repository root, in this order:

```sh
pnpm install --frozen-lockfile --offline --ignore-scripts
pnpm --filter @aidha/ingestion-youtube test -- tests/js-yaml-maintenance.test.ts
pnpm --filter @aidha/config gen:types
pnpm build:deps
pnpm --filter @aidha/config test
pnpm --filter @aidha/config lint
pnpm --filter @aidha/ingestion-youtube build
pnpm --filter @aidha/ingestion-youtube lint
pnpm --filter @aidha/ingestion-youtube exec vitest run \
  --exclude tests/real-client-config-isolation.test.ts
node scripts/meminit-check.mjs docs/55-testing/testing-068-js-yaml-dependencies.md
pnpm docs:build
```

The offline install command assumes the locked packages are already cached; a fresh environment
needs its normal authorised dependency installation first. A registry audit can still report
unrelated packages. Treat the JS-YAML-specific resolved paths separately from whole-repository
alert counts. Refresh against current main, pass fresh CI and assess actual review findings
before merging under the standing authority for noncontroversial technical changes.

## Historical verification (2026-10-17)

The reviewed source is commit `b6ed449ed084832c9223746ecd294d1f1b8b6cb7`.
A normal local merge retains the original PR 26 bot head
`421ae213468c08110e2b5f9cef0bc9a8a8e0b47d`; its resulting tree exactly matches that
reviewed source tree. The refresh does not retain unrelated toolchain updates from the
bot lockfile and does not merge the GitHub PR.

The frozen install, configuration type generation, dependency and CLI builds, and both
package lint commands passed. Generation left the checked-in generated files unchanged.
The historical record reports 317 passing configuration tests and 1,068 passing
YouTube/CLI tests, with seven skipped. Those totals do not establish the current offline
selection or coverage of the excluded fixture. The focused library regression passed both tests.
The post-change registry audit reported 17 other advisories (12 high, five moderate) and no JS-YAML
advisory. These results apply to the isolated reviewed tree, not the original mixed branch.

## Current-main refresh (2026-10-20)

This refresh composes public PR 26 with main
`27924ad75732e72a7f2a0a6c5c104c767bb5b37c`, after the Fast URI maintenance merge.
It retains the `fast-uri` override `^3.1.8` and installed resolution 3.1.8, the YouTube
`./registration` export, and all 91 existing catalogue records and navigation entries.
Only the JS-YAML floor, its three lockfile paths, this regression and its documentation change.

The current baseline check reproduced the exhausted-budget failure with JS-YAML 4.1.1
while its sufficient-budget control passed. The existing two-case regression passed
with 4.3.2. Installed-path checks confirmed 4.3.2 for the direct CLI, generator and reference
parser, alongside Fast URI 3.1.8. The frozen offline installation downloaded no packages.
Current generation left both checked-in generated configuration files unchanged.
The configuration suite passed 366 tests in 25 files. Dependency and YouTube builds,
and both package lint commands, passed.
The historical test and audit totals above apply only to their dated source tree.
Current YouTube acceptance uses the explicit fixture exclusion shown above.

The corrected YouTube run passed 1,130 tests, but its CLI memory-database suite failed
before its test when the nested build reached its 120-second limit. An isolated restricted
invocation then reported `spawnSync pnpm EPERM`. The unchanged isolated test passed on
the permitted native route in 99.27 seconds, within the original build bound. This is
1,130 passing cases plus one separately passing case, with seven existing skips. The earlier
full-suite failure remains part of the evidence; the excluded fixture has no local coverage.
