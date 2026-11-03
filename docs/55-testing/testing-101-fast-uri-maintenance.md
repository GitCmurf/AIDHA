---
document_id: AIDHA-TESTING-101
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-11-03
title: fast-uri 3.1.9 Dependency Maintenance
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-101
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-11-03
> **Type:** TESTING

# fast-uri 3.1.9 Dependency Maintenance

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-03 | Codex | Qualify the compatible fast-uri patch through the existing config schema consumer | — | Draft | Owner autonomous progress request |

## Problem and scope

Update locked fast-uri 3.1.8 to 3.1.9, the first fixed 3.x release for four
upstream advisories. The [official release][release] and advisories below provide
the independent affected baseline before changing the lockfile. No exploit
payload or provider call is needed for this dependency-maintenance qualification.

| Advisory | Severity | Affected 3.x versions | First fixed 3.x release |
| --- | --- | --- | --- |
| [GHSA-w74x-v6f9-j3xg][scheme]: percent-encoded scheme decoding | Moderate | `>=3.0.0 <3.1.9` | 3.1.9 |
| [GHSA-wjr9-j795-jxcr][host]: host canonicalisation | Moderate | `>=3.1.3 <3.1.9` | 3.1.9 |
| [GHSA-xhq7-xmqj-769h][path]: relative-path equivalence | Low | `>=3.0.0 <3.1.9` | 3.1.9 |
| [GHSA-333x-w4r6-6crp][suffix]: suffix-reference scheme confusion | Low | `>=3.0.0 <3.1.9` | 3.1.9 |

The installed consumer is `@aidha/config → ajv@8.20.0 → fast-uri`. AJV's actual
installed and [upstream regular dependency][ajv-package] is `fast-uri: ^3.0.1`.
The existing root override is `^3.1.8`; both ranges admit 3.1.9. The installed
fast-uri 3.1.9 manifest declares no runtime dependencies.

AIDHA's [validator][validator] compiles its [bundled config schema][config-schema]
with AJV. That schema has a fixed HTTPS `$id` and local `#/$defs` references for
profiles, source defaults and their nested sections. This establishes a real URI
resolution consumer. It does not establish attacker-controlled URI authorisation
or network-fetch exposure in AIDHA.

## Exact closure and resolution

The final lockfile changes only:

- The fast-uri package record and registry integrity, 3.1.8 to 3.1.9.
- AJV 8.20.0's resolved fast-uri dependency edge.
- The empty fast-uri snapshot key.

Canonical comparison against main `93cf475d29ede62c0fed7f9148ba56bfbc765312`
confirms that all 176 unrelated package records and 175 unrelated snapshots are
identical. The AJV snapshot differs only at the fast-uri edge. Every importer,
override and other top-level field is unchanged. Vite 8.1.6 and source-map-js 1.2.2
remain selected; root manifest bytes and upstream dependency metadata are unchanged.

The initial targeted `pnpm update --recursive fast-uri@3.1.9 --lockfile-only
--ignore-scripts` retained 3.1.8 and refreshed unrelated leaves. Reject that
candidate and restore the original lockfile before retrying.

For the accepted resolution, temporarily narrow the existing root fast-uri
override to exact `3.1.9`, then run the pinned pnpm 9.12.0:

```bash
pnpm install --lockfile-only --ignore-scripts
```

Restore the exact original root manifest bytes and the lockfile's root override
metadata to `^3.1.8`. Preserve pnpm's generated resolution records; do not rewrite
upstream regular or peer dependency contracts. Require the installed artifact to
be 3.1.9, frozen strict-peer installation to pass, and every unrelated lock record
to remain identical. No new direct dependency or retained resolver control is added.

## Acceptance and verification

Use the existing [config schema-validation tests][consumer] as the consumer
boundary: valid populated configurations must still compile and validate, and
invalid nested core sections must still be rejected through their `$ref` paths.
These positive and negative checks protect behaviour beyond the lockfile version.

Commands from the repository root, using Node 24.22.2 and pnpm 9.12.0:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --filter @aidha/config exec vitest run tests/schema-validation.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @aidha/config lint
pnpm --filter @aidha/config build
node scripts/meminit-check.mjs docs/55-testing/testing-101-fast-uri-maintenance.md
pnpm docs:build
```

Frozen strict-peer installation passes and skips dependency resolution. Reading
the actual package reached from AJV confirms fast-uri 3.1.9, outside all four
affected 3.x ranges, and the unchanged `^3.0.1` regular dependency contract.
All 38 existing schema-validation cases pass; config lint and build pass.

The clean-worktree installation warns that the unbuilt YouTube CLI has no generated
`dist/cli.js` binary target. That package is outside this local validation scope.
The full local workspace suite is not repeated. Full hosted default CI and actual
reporting review bots must be green before merge. Configuration defaults,
application source, watcher activation and external services are unchanged.

[release]: https://github.com/fastify/fast-uri/releases/tag/v3.1.9
[scheme]: https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg
[host]: https://github.com/fastify/fast-uri/security/advisories/GHSA-wjr9-j795-jxcr
[path]: https://github.com/fastify/fast-uri/security/advisories/GHSA-xhq7-xmqj-769h
[suffix]: https://github.com/fastify/fast-uri/security/advisories/GHSA-333x-w4r6-6crp
[ajv-package]: https://github.com/ajv-validator/ajv/blob/v8.20.0/package.json
[validator]: https://github.com/GitCmurf/AIDHA/blob/93cf475d29ede62c0fed7f9148ba56bfbc765312/packages/aidha-config/src/schema.ts
[config-schema]: https://github.com/GitCmurf/AIDHA/blob/93cf475d29ede62c0fed7f9148ba56bfbc765312/packages/aidha-config/schema/config.schema.json
[consumer]: https://github.com/GitCmurf/AIDHA/blob/93cf475d29ede62c0fed7f9148ba56bfbc765312/packages/aidha-config/tests/schema-validation.test.ts
