---
document_id: AIDHA-TESTING-094
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-18
title: Source-Owned Resource Metadata Groups
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-094
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Source-Owned Resource Metadata Groups

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.2 | 2026-10-18 | Codex | Reject sparse declarations and persist empty group ownership | — | Draft | — |
| 0.1 | 2026-10-18 | Codex | Define source-owned atomic Resource metadata groups and regression coverage | — | Draft | — |

## Scope

`RawSource.resourceMetadataGroups` lets a source declare a stable group identifier and the
Resource metadata fields that form one coupled state. The core merge persists the group's
canonical source owner and sorted field set beside those values in Resource metadata. This is a
generic merge contract; core does not assign provider-specific meaning to group identifiers or
fields. The core API also exposes `getSourceOwnedMetadataGroup` to validate and read a persisted
owner record without duplicating its schema in consumers.

For the creator-note capture integration, description, capture evidence, and capture attempt are
grouped so one refresh cannot combine values from different canonical sources. Fields outside a
declared group keep the existing scalar merge behavior.

## Acceptance

- A new group may initialize an empty alias. Omitted members are stored as `null`, giving the new
  group a complete representation.
- Declaring a new group on an empty Resource, even with no supplied values, initializes its members
  as `null` and persists its canonical owner. A later foreign source cannot claim it.
- A source that already owns a group may patch supplied members. Omission retains the last stored
  value; explicit `null` clears that member.
- An exact-canonical Resource may adopt legacy group values. Omitted existing values are retained;
  absent members are initialized as `null`.
- A populated ownerless alias is not adopted, even when its values equal the incoming values.
  A foreign owner's group patch is rejected as a whole and reported as a metadata conflict.
- A source cannot change a group's field set. Group declarations reject empty or duplicate
  identifiers/fields, sparse group or field arrays, reserved core metadata keys, and overlapping
  members. Malformed stored ownership records, including sparse stored field arrays, fail closed.
- An ordinary ungrouped write cannot alter a field already owned by a group. Unrelated ungrouped
  fields continue to use the existing merge policy.
- Group values and their ownership record are written together in the Resource metadata update.
  The contract covers sequential merge calls for one Resource. The implementation does not
  serialize concurrent read/merge/write operations; callers must avoid overlapping group updates.

## Regression coverage

`packages/praecis/core/tests/compose/source-owned-metadata.test.ts` exercises alias success followed
by failed refresh with a SQLite close/reopen, foreign-owner conflicts, ungrouped bypass rejection,
ownerless-equal and ownerless-conflicting bootstrap, exact-canonical legacy adoption, malformed and
overlapping declarations, persisted field-set changes, source-envelope ownership-key sanitization,
and explicit `null` clearing. Empty-group ownership is checked after SQLite close/reopen and against
a later foreign claim. Sparse field/group declarations must fail before creating a Resource, and a
sparse stored owner record is rejected by the reader. Existing `dedup-link` tests remain the control
for ungrouped metadata merging. The regression suite also covers member names inherited from
`Object.prototype`, so an omitted `constructor` field is initialized as absent rather than treated
as supplied metadata, and the owner reader rejects malformed persisted records.

## Verification

Build the core package before tests that consume its package artifacts:

```bash
pnpm --filter @aidha/praecis-core build
pnpm --filter @aidha/praecis-core exec vitest run tests/compose/source-owned-metadata.test.ts
pnpm --filter @aidha/praecis-core exec vitest run
pnpm --filter @aidha/praecis-core lint
node scripts/meminit-check.mjs docs/55-testing/testing-094-source-owned-metadata-groups.md
pnpm docs:build
```

Record actual command results, reused dependencies, and any incomplete checks. Do not claim
concurrent-write safety from the serial persistence tests.
