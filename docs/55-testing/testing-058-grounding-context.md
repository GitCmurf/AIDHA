---
document_id: AIDHA-TESTING-058
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
title: Shared Source Context for Grounding
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-057]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-058
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Shared Source Context for Grounding

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify the shared excerpt table and its regression checks. | — | Draft | AIDHA-PLAN-015 |

## Scope

The grounding prompt carries one `SOURCE_EXCERPTS` table for the complete supplied source.
Each unit carries its own `citedExcerptIds`, preserving the unit-to-evidence relationship.
Other source passages remain available once as context for speakers, premises, corrections and
qualifications. Context does not substitute for a unit's cited evidence, and grounding must not
change evidence to make a unit pass. The existing verdict and rewrite contract in
AIDHA-TESTING-057 still applies.

The prompt version advances when this layout changes so cached results from the previous layout
are not reused. This version change does not imply a change to the host's literal quote checks,
evidence mutability or acceptance policy.

## Acceptance and verification

- The regression in `packages/praecis/core/tests/extract/distill/prompts.test.ts` supplies ten units
  citing one shared excerpt. One unit also cites a second excerpt. Every unit retains its own
  cited IDs, and each excerpt text appears once in the encoded prompt.
- An additional uncited excerpt remains available once in the shared source table. The prompt
  explicitly says it is context and cannot replace a unit's citations.
- The existing miner tests continue to exercise grounding verdicts and immutable evidence.

Run from the repository root:

```sh
pnpm --dir packages/praecis/core exec vitest run tests/extract/distill/prompts.test.ts
pnpm --dir packages/praecis/core exec vitest run tests/extract/distill/miner.test.ts
pnpm --dir packages/praecis/core lint
node scripts/meminit-check.mjs docs/55-testing/testing-058-grounding-context.md
```

These checks establish prompt structure, source availability and host behavior with synthetic
data. They do not establish semantic accuracy of model verdicts or useful extraction from live
sources. No external provider is required for the checks.
