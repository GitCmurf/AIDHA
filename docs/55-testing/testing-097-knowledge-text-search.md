---
document_id: AIDHA-TESTING-097
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-11-03
title: Saved Knowledge Text Search
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-097
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-11-03
> **Type:** TESTING

# Saved Knowledge Text Search

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-03 | Codex | Specify saved Knowledge search, lifecycle and older-index recovery | — | Draft | Owner autonomous progress request |
| 0.2 | 2026-11-03 | Codex | Pin new search acceptance tests to their reviewed source commit | — | Draft | 0e07212 |

## Problem and scope

SQLite persists `Knowledge` nodes but omits them from its full-text index. A saved
reading note can therefore be retrieved by identifier while searches for words in
its prose return nothing. Include Knowledge alongside Claim, Excerpt and Resource
in incremental indexing and normal writable-open index recovery.

Use the existing graph API and FTS5 index. Preserve source nodes, note content,
metadata and identifiers. This change does not generate notes, adopt a writer,
integrate unpublished reading views or change the read-only snapshot contract.

## Acceptance criteria

The public SQLite store boundary is protected by
[sqlite-knowledge-fts.test.ts](https://github.com/GitCmurf/AIDHA/blob/0e072124f18fda772430e665cb3d985cd56e54ca/packages/reconditum/tests/sqlite-knowledge-fts.test.ts)
and the existing
[sqlite-fts.test.ts](https://github.com/GitCmurf/AIDHA/blob/main/packages/reconditum/tests/sqlite-fts.test.ts):

- Search finds Knowledge by prose absent from its label, with its stable node ID.
  Filtering for Knowledge excludes a matching Excerpt; unfiltered search finds both.
- Updating Knowledge removes superseded search terms and finds replacement terms.
  Deleting the node removes its search result.
- A file containing saved Knowledge and an older three-type index is closed and
  reopened. The missing Knowledge result is recovered, its complete stored node
  remains equal, and matching Claim content remains searchable.
- Reopening a complete index with Knowledge and an unindexed Topic performs no
  row writes and preserves both Knowledge and Claim search results.
- Existing Claim, Excerpt and Resource indexing, malformed-query handling and
  incomplete-index recovery remain covered.

The older-index fixture removes only Knowledge index rows before closing the
database. Assertions use the public search and retrieval APIs. The no-write control
uses a separate SQLite observer's data-version counter to detect writes across
close/reopen without timing thresholds.
Startup recovery remains a missing-row count check, not a full integrity audit.

## Verification

Run from the repository root:

```bash
pnpm --filter @aidha/graph-backend exec vitest run tests/sqlite-fts.test.ts tests/sqlite-knowledge-fts.test.ts
pnpm --filter @aidha/graph-backend test:ci
pnpm --filter @aidha/graph-backend lint
pnpm --filter @aidha/graph-backend build
node scripts/meminit-check.mjs docs/55-testing/testing-097-knowledge-text-search.md
pnpm docs:build
```

The initial lifecycle regression fails because searching the saved prose returns
an empty result. After incremental indexing is corrected, the separate file-reopen
regression still fails until startup counting and rebuilding also include Knowledge.
Synthetic passages exercise retrieval mechanics; they do not establish editorial
quality, source coverage or complete agent retrieval.
