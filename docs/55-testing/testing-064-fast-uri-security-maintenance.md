---
document_id: AIDHA-TESTING-064
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-17
title: Fast URI Security Maintenance
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-GOV-001]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-064
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Fast URI Security Maintenance

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify the v3 Fast URI security floor and production-closure checks. | — | Draft | — |
| 0.2 | 2026-10-17 | Codex | Link the actual schema and config-ingestion tests after reporting-bot review. | — | Draft | PR 41 |

## Scope

The root pnpm override keeps Fast URI on the compatible v3 line and at or above 3.1.8. The
maintainer's [v3.1.8 release](https://github.com/fastify/fast-uri/releases/tag/v3.1.8) identifies
the v3 fix for GHSA-hrr3-gc8f-f4qj; [npm publishes 3.1.8](https://www.npmjs.com/package/fast-uri/v/3.1.8).
The [advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj) lists
versions before 3.1.8 as affected. The current Dependabot snapshot lists eight open Fast URI
advisories, with published patched v3 versions no later than 3.1.8.

Fast URI is resolved below Ajv in the lockfile, and `@aidha/config` declares Ajv as a runtime
dependency. This establishes dependency closure in a production package. It does not establish that
the application exposes an advisory-specific vulnerable operation to attacker-controlled input.
Do not infer exploitability or alert closure from this version maintenance; refresh repository
alerts after merge.

## Acceptance and verification

- The root override is `^3.1.8`, constraining resolution to compatible v3 releases at or above the
  patched floor.
- The lockfile resolves Ajv's Fast URI dependency to 3.1.8 or a later v3 release, with no unrelated
  dependency version changes.
- `pnpm --filter @aidha/config test` passes the real
  [schema validation][config-schema-test] and [config ingestion][config-loader-test] tests.
- `pnpm build:deps` passes the production dependency build closure.
- `pnpm docs:build` passes with this specification in the Testing navigation.

[config-schema-test]: https://github.com/GitCmurf/AIDHA/blob/c72dbe8a97563d6d74ed6a8ffcd63fc58f41d3b3/packages/aidha-config/tests/schema-validation.test.ts
[config-loader-test]: https://github.com/GitCmurf/AIDHA/blob/c72dbe8a97563d6d74ed6a8ffcd63fc58f41d3b3/packages/aidha-config/tests/loader.test.ts

These checks verify package resolution, schema/config regression coverage, and dependent builds.
They do not reproduce all advisory behaviors, prove exploitability in AIDHA, or confirm that a
post-merge GitHub alert refresh has closed the alerts.
