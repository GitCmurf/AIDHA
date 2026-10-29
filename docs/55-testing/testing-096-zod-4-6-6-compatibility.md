---
document_id: AIDHA-TESTING-096
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-29
title: Zod 4.6.6 Compatibility
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-096
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# Zod 4.6.6 Compatibility

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-29 | Codex | Qualify the bounded runtime schema dependency update. | — | Draft | PR 64 |
| 0.2 | 2026-10-29 | Codex | Verify the qualified dependency with merged diagnostic changes. | — | Draft | PR 64; PR 51 |

## Scope and acceptance

Upgrade Zod from 4.4.3 to 4.6.6 together in the graph backend, taxonomy, shared Praecis core
and YouTube ingestion packages. Preserve the qualified development dependency graph from PR 25.
The four declarations and their lockfile importers must agree. Every non-Zod importer, package
record and snapshot must remain identical to the baseline. No application schema, migration,
provider setting, prompt, model default or test expectation changes are included.

The initial Dependabot lockfile also refreshed unrelated development dependencies. Reconstructing
the lockfile from main e3ddf73 with only the Zod entries changed removes that drift.
A parsed comparison confirms the non-Zod graph is unchanged. A frozen installation succeeds
without resolving a new graph, and all four consumers load Zod 4.6.6.
All 30 tracked source/test files importing Zod belong to those four declared consumers;
the old Zod resolution and peer-qualified references are absent from the candidate lockfile.

## Upstream changes assessed

The [4.5 announcement](https://zod.dev/blog/zod-4-5) and
[4.6 announcement](https://zod.dev/blog/zod-4-6) describe additional APIs and parser changes.
This update adopts none of the new compilation, validation or JSON-Schema import APIs.

The [record-internals correction](https://github.com/colinhacks/zod/pull/6645) changes type
declarations; workspace build and strict lint/type checks protect the existing record consumers.
The [collection-bound correction](https://github.com/colinhacks/zod/pull/6652) rejects oversized
arrays, sets and maps before parsing elements, where an applicable upper bound precedes other
checks. Inspection found unbounded arrays and lower bounds in the application schemas, but no
collection upper/exact-size bounds or Zod Set/Map schemas. No direct application trigger was
identified. Numeric upper bounds are separate from that collection change.
Production source inspection also found no positional first-Zod-issue dependency.

## Protected application contracts

The dependency update retains the existing test bodies and fixtures.

- [Taxonomy schemas](https://github.com/GitCmurf/AIDHA/blob/58b698d845fade01cc05562b9d55c21a502bc8dd/packages/phyla/tests/schema.test.ts)
  cover valid and invalid classification inputs and defaults.
- [Graph metadata validation](https://github.com/GitCmurf/AIDHA/blob/58b698d845fade01cc05562b9d55c21a502bc8dd/packages/reconditum/tests/contract/metadata-validation.test.ts)
  rejects malformed domain metadata across the available backends.
- [Graph store contracts](https://github.com/GitCmurf/AIDHA/blob/58b698d845fade01cc05562b9d55c21a502bc8dd/packages/reconditum/tests/contract/store.contract.test.ts)
  protect persistence, schema versions and metadata behaviour.
- [Creator capture](https://github.com/GitCmurf/AIDHA/blob/58b698d845fade01cc05562b9d55c21a502bc8dd/packages/praecis/core/tests/creator-capture.test.ts)
  protects strict provenance states, original description bytes and identity hashes.
- [Distillation contracts](https://github.com/GitCmurf/AIDHA/blob/58b698d845fade01cc05562b9d55c21a502bc8dd/packages/praecis/core/tests/extract/distill/schema.test.ts)
  protect invalid-input rejection, defaults, optional/null handling, refinements, error caps and
  generated wire-schema constraints.
- [Cache compatibility](https://github.com/GitCmurf/AIDHA/blob/58b698d845fade01cc05562b9d55c21a502bc8dd/packages/praecis/youtube/tests/cache-compatibility.test.ts)
  protects accepted and rejected cached payloads.

A separate bounded synthetic comparison loads the unchanged built application modules under
each Zod version. Three generated JSON-Schema variants compare equal: distillation with one
and two allowed excerpt IDs, and limitation relations. Seven distillation fixtures and four
limitation fixtures compare equal, including rejected payloads and their repair-error strings.
Creator capture output, nested metadata and defaults also compare equal. A fictional SQLite
resource written under Zod 4.4.3 is reopened under both versions; its serialised node is identical.
These comparisons support the named contracts; they are not an exhaustive database migration
audit or a live structured-output provider test.

## Artifact and provenance boundary

The downloaded 4.6.6 npm archive matches the SHA-512 integrity recorded in the lockfile and
published registry metadata. Its package name/version agree and it has no install lifecycle
scripts. Published attestations were retrieved; their cryptographic signatures were not verified.

The [official release note](https://github.com/colinhacks/zod/releases/tag/v4.6.6) explains a
rewritten upstream Git history and states that the removed malicious commits were never
published to npm. That is the maintainer's statement, not an independent security audit.
The artifact comparison does not establish a general vulnerability or publisher-trust guarantee.

## Verification

On Node 22.21.1, frozen installation, complete workspace build, workspace lint/type checks
and the canonical root test command pass. The root run includes its public-safety, test-script
and semantic-quality preflights and all 19 Vitest suites: 2,337 passed, nine existing skips.
No tests, exclusions, timeouts, fixtures or snapshots were changed for this update.

Complete workspace build, lint/type checks and the canonical root test command also pass on
official Node 22.12.0 with its required SQLite flag: 2,337 tests and nine existing skips across
19 suites. This complete root run qualifies main e3ddf73 with the narrowed dependency update;
the subsequent final-main integration is verified separately below.

Native Claude found no blocker in the dependency diff and requested the compatibility,
declaration and supported-runtime checks above before merge. Native CodeRabbit completed the
five-file dependency patch with zero findings. Independent specification and standards reviews
accepted the narrowed scope; final evidence review remains pending.

## Final main integration

Merged main ff052ba8 adds the independently reviewed diagnostic slice from PR 51.
The five dependency paths remain byte-identical to the qualified source revision; main's
lockfile is also unchanged from e3ddf73 before applying the Zod update.

After integration, the complete affected YouTube package suite passes on official Node 22.12.0:
1,163 tests, seven existing skips, 125 passing files and one skipped file. Package lint/type
checks also pass on that runtime. The 40 diagnostic/creator-note controls and four package-script
contracts pass on Node 22.21.1. These post-integration checks supplement the preceding complete
root runs; no complete final-main root rerun is claimed. No test body, snapshot, exclusion,
timeout or fixture changes are needed.

Strict documentation/DocOps and exact-head hosted checks remain final publication gates.
