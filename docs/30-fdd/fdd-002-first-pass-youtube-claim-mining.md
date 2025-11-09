---
document_id: AIDHA-FDD-002
owner: Ingestion Engineering Lead
status: Draft
version: '0.2'
last_updated: 2026-02-06
title: First-Pass YouTube Claim Mining
type: FDD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-FDD-002
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-02-06
> **Type:** FDD

# FDD: First-Pass YouTube Claim Mining

## Version History

| Version | Date       | Author | Change Summary                             | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-02-06 | AI     | Initial FDD for first-pass claim mining    | —         | Draft  | —         |
| 0.2     | 2026-02-06 | AI-assisted | Add schema and cache key detail       | —         | Draft  | —         |

## Overview

Pass 1 converts transcript excerpts into candidate claims with explicit provenance links.
Pass 2 (see `AIDHA-FDD-003`) performs deterministic editorial dedupe and final selection.
This pass prioritizes high recall and auditability over strict precision.

## Inputs

- Resource metadata (`videoId`, title, URL)
- Transcript excerpts with stable IDs and timestamps
- CLI controls (`--claims`, `--chunk-minutes`, `--max-chunks`, `--model`)
- LLM environment configuration (`AIDHA_LLM_*`)

## Processing Steps

1. Sort excerpts deterministically by timestamp and ID.
2. Chunk excerpts by configured time window.
3. Send each chunk to LLM with strict JSON schema requirements.
4. Validate and normalize candidate claims with required schema:
   - `text: string` (required, min length 1, normalized whitespace)
   - `excerptIds: string[]` (required, non-empty, each value must match known excerpt ID)
   - `startSeconds: number` (optional, if absent derive from earliest cited excerpt, must be `>= 0`)
   - `type: string` (optional, normalized lower-case enum-like value)
   - `confidence: number` (optional, clamped to `0.0..1.0`)
5. Persist validated candidates to cache using deterministic key components.

### Candidate schema example

```json
{
  "claims": [
    {
      "text": "Deterministic IDs avoid duplicate nodes across re-ingestion runs.",
      "excerptIds": ["excerpt-abc123"],
      "startSeconds": 42,
      "type": "insight",
      "confidence": 0.82
    }
  ]
}
```

Allowed `type` values currently include:
`insight`, `instruction`, `fact`, `decision`, `warning`, `question`, `summary`, `example`.

## Outputs

- Candidate claims for editor pass (`AIDHA-FDD-003`).
- Optional fallback candidates from heuristic extractor when LLM parse fails.
- Cache artifacts at `./out/cache/claims` (override with `AIDHA_LLM_CACHE_DIR`).

## Heuristic extractor (fallback)

When LLM parsing returns empty/invalid output, fallback extraction is invoked for that chunk.

- Trigger conditions:
  - invalid JSON schema after retry
  - empty candidate list
  - LLM request failure
- Fallback behavior:
  - convert excerpt text to low-confidence candidates
  - preserve excerpt provenance and timestamps
  - mark extraction method as `heuristic`

## Failure Handling

- Parse failures trigger one strict retry.
- Empty/invalid chunk output falls back to heuristic candidates.
- Cache metadata mismatch invalidates stale cache safely.

## Cache key specification

Chunk cache key material is serialized in this exact order:

1. `videoId`
2. `chunk.index`
3. `chunk.start`
4. `chunk.end`
5. `transcriptHash` (`sha256` over sorted excerpt IDs + starts + text)
6. `model`
7. `promptVersion`

The serialized sequence is hashed with the shared `hashId` helper and written to
`<cacheDir>/<cacheKey>.json`. Cache payload also stores metadata fields for validation on read.

## Test Coverage

- `packages/praecis/youtube/tests/llm-claims.test.ts`
  - chunk cache behavior
  - cache invalidation by prompt/model/transcript hash
  - metadata persistence into stored claims
