# AIDHA Config Schema Changes

This document tracks all changes to the AIDHA configuration schema (`config.schema.json`).

## [1.0] - 2026-05-15

### Initial Stable Release
- Five-tier precedence: CLI → Profile → Source → Default → Hardcoded.
- Core sections: `llm`, `editor`, `extraction`, `export`.
- Support for `source_overrides` within profiles.
- Support for ingestion-source defaults in `sources`.
- Environment variable interpolation with `${VAR}` and `${VAR:-fallback}`.
- Dotenv file support via `env.dotenv_files`.
- Safe editing with backup rotation and validation.
- Redaction of sensitive keys (API keys, cookies).
