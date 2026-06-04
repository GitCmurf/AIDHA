---
document_id: AIDHA-GUIDE-003
owner: Ingestion Team
status: Draft
last_updated: 2026-06-04
version: '0.39'
title: Ingestion Quickstart
type: GUIDE
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GUIDE-003
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.39
> **Last Updated:** 2026-06-04
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
| 0.20    | 2026-02-08 | AI     | Add preflight command and subcommand help usage | — | Draft | — |
| 0.21    | 2026-02-08 | AI     | Add fixtures import command and query regression notes | — | Draft | — |
| 0.22    | 2026-02-09 | AI     | Refresh fixture workflow details and timestamp metadata | — | Draft | — |
| 0.23    | 2026-02-09 | AI     | Add claims purge command for clean extraction reruns | — | Draft | — |
| 0.24    | 2026-02-09 | AI     | Add source-prefixed default export filenames | — | Draft | — |
| 0.25    | 2026-02-23 | AI     | Replace placeholder HTTP URLs with non-link tokens for stable linkcheck. | — | Draft | — |
| 0.26    | 2026-05-21 | AI     | Add architecture note referencing multi-vector model (PLAN-007 Phase 0) | — | Draft | — |
| 0.27    | 2026-05-22 | AI     | Add podcast ingest command and note the shared multi-vector CLI surface. | — | Draft | — |
| 0.28    | 2026-05-22 | AI     | Add Readwise batch ingest command and note the shared export cursor surface. | — | Draft  | — |

| 0.29    | 2026-05-22 | AI     | Email import. | —         | Draft  | —         |
| 0.30    | 2026-05-22 | AI     | LinkedIn paste. | —         | Draft  | —         |
| 0.31    | 2026-05-25 | AI     | Clarify Resource metadata. | — | Draft | AIDHA-PLAN-007 |
| 0.32    | 2026-05-25 | AI     | Clarify classification status. | — | Draft | AIDHA-PLAN-007 |
| 0.33    | 2026-05-25 | AI     | Document config-seeded taxonomy. | — | Draft | AIDHA-PLAN-007 |
| 0.34    | 2026-05-25 | AI     | Clarify durable taxonomy. | — | Draft | AIDHA-PLAN-007 |
| 0.35    | 2026-05-31 | AI     | Add generic activation commands. | — | Draft | AIDHA-TASK-010 |
| 0.36    | 2026-05-31 | AI     | Document `--mock-llm` ingest. | — | Draft | AIDHA-TASK-010 |
| 0.37    | 2026-05-31 | AI     | Add trace review commands. | — | Draft | AIDHA-TASK-010 |
| 0.38    | 2026-06-01 | AI     | Generic activation quickstart. | — | Draft | AIDHA-TASK-010 |
| 0.39    | 2026-06-04 | AI     | Document transcript cache. | — | Draft | AIDHA-TASK-010 |

## Purpose

Run local ingestion through the generic `aidha` CLI, activate captured claims into tasks and project
re-entry, and export graph evidence. The YouTube CLI remains useful for YouTube-specific diagnostics,
but the generic CLI is the canonical pilot surface where parity exists.

## Architecture Note

This quickstart uses the generic activation surface across source vectors. The YouTube ingestion
vector remains the Phase 0 reference implementation of AIDHA's four-axis ingestion model
(**Acquire → Decode → Contextualize → Extract**). New vectors are registered by implementing
`IIngestor` and `IDecodeStrategy` from
`@aidha/praecis-core` and wiring them via `composeVector()`. See AIDHA-PRD-002 for the full
architecture description.

Every ingestor may supply `RawSource.resourceMetadata`; the shared spine persists
that source-specific metadata on the Resource alongside canonical identity,
dedup keys, provenance, and label. YouTube CLI ingestion and claim extraction both
call the same production `ingestYouTubeVideo()` entrypoint, so channel,
description, duration, and transcript-state metadata seen in dossiers is produced
by the same path users run locally.

Classification is a shared optional spine step for every vector. Add tags under
`extensions.taxonomy` in the resolved config to enable the default classifier in
production CLI runs. Reports distinguish `tagsMatched` from durable net-new
`tagsAssigned`; assignments persist on Resource metadata as `taxonomyAssignments`
so fresh CLI reruns do not re-count already tagged Resources. Without taxonomy,
reports show classification as disabled.

## Generic Activation Commands

The generic `aidha` CLI is now the preferred surface for source-neutral activation after material is
in the configured graph store. These commands operate across source types and preserve provenance
through Claim -> Excerpt -> Resource links.

```bash
aidha query "activation loop" --json
aidha query "activation loop" --include-drafts
aidha review next --limit 10 --json
aidha task create --from-claim <claim-id> --title "Follow up" --project <project-id>
aidha task show <task-id> --json
aidha trace list --json
aidha trace show <trace-id> --json
aidha trace reject <trace-id> --reason "Not actionable yet"
aidha project reentry --project <project-id> --markdown --out out/project-reentry.md
aidha export graph --jsonld --out out/graph.jsonld
```

Use `--config <path>` when running against a non-default local profile. Query results include locator
data for source-specific provenance; task and project re-entry output follows the same provenance
chain so a created task can be traced back to its supporting source.

For no-network acceptance runs, pass `--mock-llm` to generic ingest commands that need claim
extraction. This injects the deterministic local test double used by
`scripts/acceptance/viable-prototype-activation.mjs`.

## Quickstart: Generic Activation Loop

This is the recommended pilot-readiness path. It uses local files and pasted text, keeps extraction
offline with `--mock-llm`, and produces task and graph-export evidence that can be inspected without
opening the source material again.

1. **Ingest heterogeneous local sources**

   ```bash
   aidha ingest pdf --file ./docs/55-testing/acceptance-run-20260531/fixture-prototype.pdf \
     --mock-llm \
     --json

   aidha ingest linkedin \
     --paste "Activation planning converts captured knowledge into concrete next actions." \
     --url https://linkedin.example.test/posts/activation-prototype \
     --mock-llm \
     --json
   ```

2. **Find prior claims across source types**

   ```bash
   aidha query "activation planning" --include-drafts --json
   aidha review next --json
   ```

3. **Create and inspect a provenance-backed task**

   ```bash
   aidha task create \
     --from-claim <claim-id> \
     --title "Follow up on this claim" \
     --project project-viable-prototype \
     --json

   aidha task show <task-id> --json
   ```

4. **Re-enter the project and export graph evidence**

   ```bash
   aidha project reentry \
     --project project-viable-prototype \
     --markdown \
     --out out/project-reentry.md

   aidha export graph --jsonld --out out/graph.jsonld
   ```

The maintained no-network evidence packet for this loop is AIDHA-TESTING-005 under
`docs/55-testing/acceptance-run-20260531/`. Use AIDHA-TESTING-006 when running the real two-project
pilot.

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
   pnpm -C packages/praecis/youtube cli ingest video <video-url>
   ```

2. **Check ingestion status**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest status <video-url>
   ```

   Add `--json` for machine-readable output:

   ```bash
   pnpm -C packages/praecis/youtube cli ingest status <video-url> --json
   ```

3. **Run environment preflight**

   ```bash
   pnpm -C packages/praecis/youtube cli preflight youtube
   ```

   Optional network probe (runs only when explicitly requested):

   ```bash
   pnpm -C packages/praecis/youtube cli preflight youtube \
     --probe-url <video-url> \
     --json
   ```

4. **Extract claims**

   ```bash
   pnpm -C packages/praecis/youtube cli extract claims <video-url>
   ```

   Claims default to `state=accepted`. Query and dossier export only include
   accepted claims.

   LLM-backed extraction (optional):

   ```bash
   AIDHA_LLM_BASE_URL=<llm-base-url> \
   AIDHA_LLM_API_KEY=... \
   pnpm -C packages/praecis/youtube cli extract claims <video-url> \
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

   LLM extraction runs in two passes inside the canonical miner: chunk-level candidate
   mining followed by deterministic merge/selection. Cache keys include transcript
   hash + prompt version + model.

   YouTube transcript acquisition has its own normalized local cache at
   `./out/cache/youtube-transcripts`, so repeated ingestion of the same video does not
   need to re-fetch captions from YouTube. Use `--refresh-transcript` on the generic
   `aidha ingest youtube` command or the YouTube-specific ingest command when you need
   to bypass and rewrite that transcript cache. Configure the cache under
   `source_overrides.youtube.youtube.transcript_cache` when the default path is not
   suitable.

   Optional rewrite pass (`--editor-llm`): rewrites selected claims for readability while
   keeping numeric values and excerpt-grounded keywords. Rewrite cache keys include transcript
   hash + candidate-set hash + model + rewrite prompt version.

5. **Export dossier**

   ```bash
   pnpm -C packages/praecis/youtube cli export dossier video <video-url>
   ```

   Default output path: `./out/dossier-youtube-<id>.md`

   Split accepted vs draft-inclusive outputs:

   ```bash
   pnpm -C packages/praecis/youtube cli export dossier video <video-url> \
     --split-states \
     --out ./out/dossier-<id>.md
   ```

   This writes:

   - `./out/dossier-<id>.md` (accepted/default states)
   - `./out/dossier-<id>.draft.md` (accepted + draft)

6. **Export transcript JSON**

   ```bash
   pnpm -C packages/praecis/youtube cli export transcript video <video-url>
   ```

   Default output path: `./out/transcript-youtube-<id>.json`

   Override prefix if needed:

   ```bash
   pnpm -C packages/praecis/youtube cli export transcript video <video-url> \
     --source-prefix yt
   ```

7. **Create a task from a claim**

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

8. **Query with filters**

   ```bash
   pnpm -C packages/praecis/youtube cli query "TypeScript" --project inbox
   ```

   ```bash
   pnpm -C packages/praecis/youtube cli query "TypeScript" --area <areaId> --goal <goalId>
   ```

   Note: SQLite backends use FTS5 indexing for faster claim/transcript search when available.

9. **Show task context**

   ```bash
   pnpm -C packages/praecis/youtube cli task show <taskId>
   ```

10. **Find related claims**

   ```bash
   pnpm -C packages/praecis/youtube cli related --claim <claimId> --limit 5
   ```

- **Purge existing claims for a clean rerun (optional)**

   ```bash
   pnpm -C packages/praecis/youtube cli claims purge <video-url>
   ```

   This removes `Claim` nodes for the video and cascades related claim edges.
   It does not delete the `Resource` or `Excerpt` nodes.

## Quickstart (Other Vectors)

The shared `aidha` CLI now exposes the non-YouTube ingestion vectors implemented in
PLAN-007. Each command runs offline against local fixtures or injected mocks.

```bash
aidha ingest web --url <url>
aidha ingest pdf --file <path>
aidha ingest rss --feed <url> [--item-guid <guid>]
aidha ingest voice --file <path>
aidha ingest meeting --file <path>
aidha ingest podcast --feed <url> [--episode <guid>] [--panel]
aidha ingest readwise --since <iso8601> [--token <token>]
aidha ingest email --file <path>
aidha ingest linkedin --paste <text> [--url <url>]
```

Use `--json` to emit machine-readable summaries for scripts and regression checks.

The email import path accepts a single `.eml` file or a directory of `.eml`
messages, reconstructs threads deterministically, and emits per-thread summaries
with `message` locators.

LinkedIn paste imports accept `--paste` with a value, or `--paste` with no value
to read from stdin, and optionally attach a provenance-only `--url`.

- **Review drafts in batches**

   ```bash
   pnpm -C packages/praecis/youtube cli review next <video-url> --state draft --limit 10
   ```

   ```bash
   pnpm -C packages/praecis/youtube cli review apply \
     --claims <id1,id2> \
     --accept \
     --tag "research,backend"
   ```

- **Run diagnostics**

   ```bash
   pnpm -C packages/praecis/youtube cli diagnose transcript <video-url>
   pnpm -C packages/praecis/youtube cli diagnose extract <video-url>
   pnpm -C packages/praecis/youtube cli diagnose editor <video-url>
   ```

   Note: `diagnose transcript` exits with code `2` when JS runtime support for `yt-dlp`
   is missing.
   `diagnose editor` uses cached LLM candidates only and exits with code `2` when cache
   is unavailable. It does not trigger new LLM calls.

- **Create area/goal/project links**

   ```bash
   pnpm -C packages/praecis/youtube cli area create --name "Health"
   pnpm -C packages/praecis/youtube cli goal create --name "Lower BP" --area area-health
   pnpm -C packages/praecis/youtube cli project create \
     --name "Meditation Habit" \
     --area area-health \
     --goal goal-lower-bp
   ```

- **Import TTML as deterministic fixture JSON**

   ```bash
   pnpm -C packages/praecis/youtube cli fixtures import-ttml \
     ./testdata/youtube_golden/raw/<videoId>.en-orig.ttml \
     --video-id <videoId> \
     --source-url <video-url> \
     --out ./testdata/youtube_golden/<videoId>.excerpts.json \
     --pretty
   ```

## Transcript Fallbacks

When direct YouTube transcript fetches fail, ingestion falls back to `yt-dlp`. You can control it
per run:

```bash
pnpm -C packages/praecis/youtube cli ingest video <video-url> \
  --ytdlp-cookies /path/to/cookies.txt \
  --ytdlp-keep
```

- `--ytdlp-cookies`: path to Netscape cookie file
- `--ytdlp-keep`: keep temporary subtitle files for inspection
- `--ytdlp-bin`: custom `yt-dlp` binary path
- `--ytdlp-timeout`: override `yt-dlp` timeout in milliseconds
- `--ytdlp-js-runtimes`: set JS runtime list (default: `node`)

## Help Retrieval

- Global help: `pnpm -C packages/praecis/youtube cli help`
- Subcommand help: `pnpm -C packages/praecis/youtube cli <command> --help`
