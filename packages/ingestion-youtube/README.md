# @aidha/ingestion-youtube

Pipeline package that ingests YouTube playlists, captures transcripts, classifies entries using the
shared taxonomy, enriches graph metadata, and emits summaries/editorial commentary for humans + AI.

- Depends on the graph backend + taxonomy packages; reflect these via pnpm dependencies once APIs exist.
- Store ingestion prompts and evaluation suites under `prompts/` with DocOps-compliant metadata.
- Provide a CLI entry point (`pnpm ingest dev --playlist <id>`) and document it in quickstarts/runbooks.

Roadmap + DocOps expectations live in `docs/60-devex/Initial_Tools_Roadmap.md`.
