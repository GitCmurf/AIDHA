# @aidha/ingestion-youtube

YouTube ingestion and extraction package for the AIDHA MVP.

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
