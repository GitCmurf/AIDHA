---
document_id: PRAECIS-REF-001
owner: Ingestion Engineering Lead
status: Draft
version: "1.2"
last_updated: 2026-05-03
title: YouTube Ingestion Package README
type: REF
docops_version: "2.0"
area: INGEST
keywords: [praecis, youtube, ingestion, cli, evaluation]
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** PRAECIS-REF-001
> **Owner:** Ingestion Engineering Lead
> **Status:** Draft
> **Version:** 1.2
> **Last Updated:** 2026-05-03
> **Type:** REF

# @aidha/ingestion-youtube

YouTube ingestion and extraction package for the AIDHA MVP.

## Version History

| Version | Date       | Author | Change Summary                                      | Status |
| ------- | ---------- | ------ | --------------------------------------------------- | ------ |
| 1.0     | 2026-05-03 | AI     | Add governed README metadata and current CLI usage. | Draft |
| 1.1     | 2026-05-03 | AI     | Document CI-safe and exhaustive test commands.      | Draft |
| 1.2     | 2026-05-03 | AI     | Restore eval coverage in the CI test entry point.   | Draft |

Core capabilities:

- ingest playlist/video metadata + transcripts
- extract claims (heuristic or LLM-backed two-pass)
- extract references
- review and curate claims (`draft|accepted|rejected`)
- export dossier/transcript artifacts
- query and relate captured claims

## CLI

Run:

- `pnpm -C packages/praecis/youtube cli help`

Common workflow:

1. `pnpm -C packages/praecis/youtube cli ingest video <url>`
2. `pnpm -C packages/praecis/youtube cli extract claims <url> --llm --model <id>`
3. `pnpm -C packages/praecis/youtube cli review next <url> --state draft`
4. `pnpm -C packages/praecis/youtube cli export dossier video <url>`
5. `./scripts/eval-matrix/run-gemini-remediation-loop.sh --review-file review.txt --max-iterations 1 --verify-mode quick`

Use `--verify-mode full` when you want the docs build in the loop, and `--heartbeat-seconds` to tune progress updates for long Gemini runs.

## Testing

- `pnpm test` at the repository root runs the bounded CI regression gate.
- `pnpm -C packages/praecis/youtube test:ci` runs the full YouTube package suite with CI-friendly output.
- `pnpm -C packages/praecis/youtube test:full` runs the same exhaustive suite with the default Vitest reporter.

## Environment Variables

- `AIDHA_LLM_API_KEY`: LLM API key used for `extract claims --llm`.
- `YOUTUBE_COOKIE`: optional cookie value for gated transcript retrieval.
- `YOUTUBE_INNERTUBE_API_KEY`: optional InnerTube API key for YouTube fetch flows.

Config files support `${VAR}` interpolation. Example:

```yaml
youtube:
  cookie: ${YOUTUBE_COOKIE}
  innertube_api_key: ${YOUTUBE_INNERTUBE_API_KEY}
llm:
  api_key: ${AIDHA_LLM_API_KEY}
```

## Key Docs

- Quickstart: `docs/60-devex/ingest-quickstart.md`
- Operations runbook: `docs/50-runbooks/runbook-003-youtube-ingestion.md`
- Two-pass extraction architecture: `docs/20-adr/adr-007-two-pass-llm-extraction-architecture.md`
- First/second pass designs: `docs/30-fdd/fdd-002-first-pass-youtube-claim-mining.md`,
  `docs/30-fdd/fdd-003-second-pass-editorial-selection.md`
