---
document_id: AIDHA-RUNBOOK-003
owner: Ingestion Oncall
status: Draft
last_updated: 2026-02-06
version: '1.5'
title: YouTube Ingestion Operations
type: RUNBOOK
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-RUNBOOK-003
> **Owner:** Ingestion Oncall
> **Approvers:** —
> **Status:** Draft
> **Version:** 1.5
> **Last Updated:** 2026-02-06
> **Type:** RUNBOOK

## Version History

| Version | Date       | Author | Change Summary                              | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------- | --------- | ------ | --------- |
| 0.2     | 2025-12-27 | CMF    | Migrate to Meminit DocOps 2.0               | —         | Draft  | —         |
| 0.3     | 2025-12-27 | CMF    | Add required Version History for validation | —         | Draft  | —         |
| 0.4     | 2026-02-04 | CMF    | Add transcript troubleshooting + yt-dlp     | —         | Draft  | —         |
| 0.5     | 2026-02-04 | CMF    | Add yt-dlp timeout flag                     | —         | Draft  | —         |
| 0.6     | 2026-02-04 | CMF    | Add ingest status command                   | —         | Draft  | —         |
| 0.7     | 2026-02-05 | CMF    | Add JSON status output                      | —         | Draft  | —         |
| 0.8     | 2026-02-05 | CMF    | Add LLM claim extraction notes              | —         | Draft  | —         |
| 0.9     | 2026-02-05 | CMF    | Add task creation + query filters           | —         | Draft  | —         |
| 1.0     | 2026-02-05 | CMF    | Add task show command                       | —         | Draft  | —         |
| 1.1     | 2026-02-05 | CMF    | Note SQLite FTS search                      | —         | Draft  | —         |
| 1.2     | 2026-02-05 | CMF    | Wrap long lines                             | —         | Draft  | —         |
| 1.3     | 2026-02-05 | CMF    | Add code fence languages                    | —         | Draft  | —         |
| 1.4     | 2026-02-06 | AI     | Note claim state default                    | —         | Draft  | —         |
| 1.5     | 2026-02-06 | AI     | Document two-pass claim extraction          | —         | Draft  | —         |

## Purpose

Placeholder runbook describing ingestion job schedules, retry policies, alert responses, and
auditing steps.

## Operational Checklist

1. **Build dependencies**

   ```bash
   pnpm -C packages/reconditum build
   pnpm -C packages/praecis/youtube build
   ```

2. **Run ingestion**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest video <url>
   ```

3. **Check ingestion status**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest status <url>
   ```

   Add `--json` for machine-readable output:

   ```bash
   pnpm -C packages/praecis/youtube cli ingest status <url> --json
   ```

4. **Verify claims**

   ```bash
   pnpm -C packages/praecis/youtube cli extract claims <url>
   ```

   Note: new claims default to `state=accepted`. Query and dossier export include
   accepted claims only.

5. **Create a task**

   ```bash
   pnpm -C packages/praecis/youtube cli task create \
     --from-claim <claimId> \
     --title "Follow up on this claim" \
     --project inbox
   ```

6. **Query with filters**

   ```bash
   pnpm -C packages/praecis/youtube cli query "TypeScript" --project inbox
   ```

   Note: SQLite backends use FTS5 indexing for faster claim/transcript search when available.

7. **Show task context**

   ```bash
   pnpm -C packages/praecis/youtube cli task show <taskId>
   ```

   For LLM-backed claims:

   ```bash
   AIDHA_LLM_BASE_URL=https://your-llm-endpoint/v1 \
   AIDHA_LLM_API_KEY=... \
   pnpm -C packages/praecis/youtube cli extract claims <url> \
     --llm \
     --model your-model \
     --claims 15 \
     --chunk-minutes 5 \
     --max-chunks 20
   ```

   LLM extraction uses two passes:
   1. chunk-level candidate mining (3-8 claims/chunk target)
   2. deterministic editor merge/selection to produce final claims

   Cache keys include transcript hash + prompt version + model, so prompt/model/transcript changes
   correctly bypass stale cache.

## Transcript Troubleshooting

If ingestion reports missing transcripts:

1. **Enable diagnostics**

   ```bash
   AIDHA_DEBUG_TRANSCRIPT=1 pnpm -C packages/praecis/youtube cli ingest video <url>
   ```

2. **Install `yt-dlp`**

   - Use `yt-dlp --version` to confirm availability.

3. **Use cookie file for gated captions**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest video <url> --ytdlp-cookies /path/to/cookies.txt
   ```

4. **Keep subtitle files for inspection**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest video <url> --ytdlp-keep
   ```

5. **Custom `yt-dlp` binary (optional)**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest video <url> --ytdlp-bin /path/to/yt-dlp
   ```

6. **Override `yt-dlp` timeout (optional)**

   ```bash
   pnpm -C packages/praecis/youtube cli ingest video <url> --ytdlp-timeout 180000
   ```

Inspect the temporary subtitle files to confirm formats (`.vtt`, `.ttml`, `.json3`).
