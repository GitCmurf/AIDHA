---
document_id: AIDHA-TESTING-068
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
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
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Patched JS-YAML Dependency Paths

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify compatible YAML dependency resolution and bounded merge-work regression. | — | Draft | AIDHA-PLAN-015; PR 26 |

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

The current repository snapshot has four open JS-YAML advisories. Their patched 4.x floors
are covered by 4.3.2; version coverage does not establish application reachability or close
GitHub alerts before the change is merged and re-audited.

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

Run from the repository root, in this order:

```sh
pnpm install --frozen-lockfile --offline
pnpm --filter @aidha/ingestion-youtube test -- tests/js-yaml-maintenance.test.ts
pnpm --filter @aidha/config gen:types
pnpm build:deps
pnpm --filter @aidha/config test
pnpm --filter @aidha/config lint
pnpm --filter @aidha/ingestion-youtube build
pnpm --filter @aidha/ingestion-youtube lint
pnpm --filter @aidha/ingestion-youtube test
node scripts/meminit-check.mjs docs/55-testing/testing-068-js-yaml-dependencies.md
pnpm docs:build
```

The offline install command assumes the locked packages are already cached; a fresh environment
needs its normal authorised dependency installation first. A registry audit can still report
unrelated packages. Treat the JS-YAML-specific resolved paths separately from whole-repository
alert counts. Named approval is required before merging PR 26.

## Verification record

The reviewed source is commit `b6ed449ed084832c9223746ecd294d1f1b8b6cb7`.
A normal local merge retains the original PR 26 bot head
`421ae213468c08110e2b5f9cef0bc9a8a8e0b47d`; its resulting tree exactly matches that
reviewed source tree. The refresh does not retain unrelated toolchain updates from the
bot lockfile and does not merge the GitHub PR.

The frozen install, configuration type generation, dependency and CLI builds, and both
package lint commands passed. Generation left the checked-in generated files unchanged.
All 317 configuration tests passed; the complete YouTube/CLI suite passed 1,068 tests,
with seven skipped. The focused library regression passed both tests. The post-change
registry audit reported 17 other advisories (12 high, five moderate) and no JS-YAML
advisory. These results apply to the isolated reviewed tree, not the original mixed branch.
