---
document_id: AIDHA-GUIDE-003
owner: Ingestion Team
status: Draft
last_updated: 2026-02-08
version: '0.19'
title: Ingestion Quickstart
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-003
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.19
> **Last Updated:** 2026-02-08
> **Type:** GUIDE

## Version History

| Version | Date       | Author | Change Summary                            | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ----------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-11-09 | TBD    | Seed placeholder quickstart               | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Adopt DocOps 2.0 ID + add Version History | —         | Draft  | —         |
| 0.3     | 2026-02-04 | CMF    | Document CLI usage + yt-dlp fallback      | —         | Draft  | —         |
| 0.4     | 2026-02-04 | CMF    | Add yt-dlp timeout flag                   | —         | Draft  | —         |
| 0.5     | 2026-02-04 | CMF    | Add ingest status check                   | —         | Draft  | —         |
| 0.6     | 2026-02-05 | CMF    | Add JSON status output                    | —         | Draft  | —         |
| 0.7     | 2026-02-05 | CMF    | Document LLM claim extraction             | —         | Draft  | —         |
| 0.8     | 2026-02-05 | CMF    | Document task creation + query filters    | —         | Draft  | —         |
| 0.9     | 2026-02-05 | CMF    | Add task show command                     | —         | Draft  | —         |
| 0.10    | 2026-02-05 | AI     | Align version + clarify prerequisites     | —         | Draft  | —         |
| 0.11    | 2026-02-05 | AI     | Add code fence languages                  | —         | Draft  | —         |
| 0.12    | 2026-02-06 | AI     | Note claim state default                  | —         | Draft  | —         |
| 0.13    | 2026-02-06 | AI     | Document two-pass claim extraction        | —         | Draft  | —         |
| 0.14    | 2026-02-06 | AI     | Add review, related, and diagnose usage  | —         | Draft  | —         |
| 0.15    | 2026-02-07 | AI     | Add project create helper usage          | —         | Draft  | —         |
| 0.16    | 2026-02-07 | AI     | Add split dossier and transcript export usage | —      | Draft  | —         |
| 0.17    | 2026-02-07 | AI     | Add yt-dlp JS runtime option + diagnose behavior | —   | Draft  | —         |
| 0.18    | 2026-02-08 | AI     | Add editor v2 extraction flags + diagnose editor mode | — | Draft | — |
| 0.19    | 2026-02-08 | AI     | Add optional editor rewrite flag and guardrail notes | — | Draft | — |

## Purpose

Outline how to use API keys, run local ingestion via the YouTube CLI, and inspect outputs.

## Prerequisites

- `pnpm install`
- `pnpm -C packages/reconditum build`
- `pnpm -C packages/praecis/youtube build`
- `yt-dlp` installed (optional; used as a fallback when direct YouTube transcript fetch fails)

Optional:

- `AIDHA_YTDLP_COOKIES_FILE=/path/to/cookies.txt` for gated transcripts
- `AIDHA_DEBUG_TRANSCRIPT=1` to print transcript diagnostics
- `AIDHA_LLM_BASE_URL` and `AIDHA_LLM_API_KEY` for LLM claim extraction
- `AIDHA_LLM_MODEL` default model name
- `AIDHA_LLM_CACHE_DIR` override cache path (default `./out/cache/claims`)
- `AIDHA_LLM_TIMEOUT_MS` override LLM request timeout
- `AIDHA_CLAIMS_PROMPT_VERSION` override prompt version (default `v1`)

## Quickstart (Video)

1. **Ingest**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest video https://youtu.be/<id>
   ```

2. **Check ingestion status**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest status https://youtu.be/<id>
   ```

   Add `--json` for machine-readable output:

   ```bash
   pnpm -C packages/praecis/youtube cli ingest status https://youtu.be/<id> --json
   ```

3. **Extract claims**

   ```bash
   pnpm -C packages/praecis/youtube cli extract claims https://youtu.be/<id>
   ```

   Claims default to `state=accepted`. Query and dossier export only include
   accepted claims.

   LLM-backed extraction (optional):

   ```bash
   AIDHA_LLM_BASE_URL=https://your-llm-endpoint/v1 \
   AIDHA_LLM_API_KEY=... \
   pnpm -C packages/praecis/youtube cli extract claims https://youtu.be/<id> \
     --llm \
     --model your-model \
     --editor-version v2 \
     --editor-llm \
     --claims 15 \
     --chunk-minutes 5 \
     --max-chunks 20 \
     --window-minutes 5 \
     --max-per-window 3 \
     --min-windows 4 \
     --min-words 8 \
     --min-chars 50
   ```

   LLM extraction runs in two passes: chunk-level candidate mining followed by deterministic
   editor merge/selection. Cache keys include transcript hash + prompt version + model.

   Optional rewrite pass (`--editor-llm`): rewrites selected claims for readability while
   keeping numeric values and excerpt-grounded keywords. Rewrite cache keys include transcript
   hash + candidate-set hash + model + rewrite prompt version.

4. **Export dossier**

   ```bash
   pnpm -C packages/praecis/youtube cli export dossier video https://youtu.be/<id>
   ```

   Split accepted vs draft-inclusive outputs:

   ```bash
   pnpm -C packages/praecis/youtube cli export dossier video https://youtu.be/<id> \
     --split-states \
     --out ./out/dossier-<id>.md
   ```

   This writes:

   - `./out/dossier-<id>.md` (accepted/default states)
   - `./out/dossier-<id>.draft.md` (accepted + draft)

5. **Export transcript JSON**

   ```bash
   pnpm -C packages/praecis/youtube cli export transcript video https://youtu.be/<id>
   ```

6. **Create a task from a claim**

   ```bash
   pnpm -C packages/praecis/youtube cli task create \
     --from-claim <claimId> \
     --title "Follow up on this claim" \
     --project inbox
   ```

   Optional tags:

   ```bash
   pnpm -C packages/praecis/youtube cli task create \
     --from-claim <claimId> \
     --title "Follow up on this claim" \
     --tag "research,backend"
   ```

7. **Query with filters**

   ```bash
   pnpm -C packages/praecis/youtube cli query "TypeScript" --project inbox
   ```

   ```bash
   pnpm -C packages/praecis/youtube cli query "TypeScript" --area <areaId> --goal <goalId>
   ```

   Note: SQLite backends use FTS5 indexing for faster claim/transcript search when available.

8. **Show task context**

   ```bash
   pnpm -C packages/praecis/youtube cli task show <taskId>
   ```

9. **Find related claims**

   ```bash
   pnpm -C packages/praecis/youtube cli related --claim <claimId> --limit 5
   ```

10. **Review drafts in batches**

   ```bash
   pnpm -C packages/praecis/youtube cli review next https://youtu.be/<id> --state draft --limit 10
   ```

   ```bash
   pnpm -C packages/praecis/youtube cli review apply \
     --claims <id1,id2> \
     --accept \
     --tag "research,backend"
   ```

1. **Run diagnostics**

   ```bash
   pnpm -C packages/praecis/youtube cli diagnose transcript https://youtu.be/<id>
   pnpm -C packages/praecis/youtube cli diagnose extract https://youtu.be/<id>
   pnpm -C packages/praecis/youtube cli diagnose editor https://youtu.be/<id>
   ```

   Note: `diagnose transcript` exits with code `2` when JS runtime support for `yt-dlp`
   is missing.
   `diagnose editor` uses cached LLM candidates only and exits with code `2` when cache
   is unavailable. It does not trigger new LLM calls.

1. **Create area/goal/project links**

   ```bash
   pnpm -C packages/praecis/youtube cli area create --name "Health"
   pnpm -C packages/praecis/youtube cli goal create --name "Lower BP" --area area-health
   pnpm -C packages/praecis/youtube cli project create \
     --name "Meditation Habit" \
     --area area-health \
     --goal goal-lower-bp
   ```

## Transcript Fallbacks

When direct YouTube transcript fetches fail, ingestion falls back to `yt-dlp`. You can control it
per run:

```bash
pnpm -C packages/praecis/youtube cli ingest video https://youtu.be/<id> \
  --ytdlp-cookies /path/to/cookies.txt \
  --ytdlp-keep
```

- `--ytdlp-cookies`: path to Netscape cookie file
- `--ytdlp-keep`: keep temporary subtitle files for inspection
- `--ytdlp-bin`: custom `yt-dlp` binary path
- `--ytdlp-timeout`: override `yt-dlp` timeout in milliseconds
- `--ytdlp-js-runtimes`: set JS runtime list (default: `node`)
