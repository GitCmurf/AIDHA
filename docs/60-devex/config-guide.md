---
document_id: AIDHA-GUIDE-005
owner: Repo Maintainers
status: Draft
last_updated: 2026-05-18
version: "1.6"
title: AIDHA Configuration Guide
type: GUIDE
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-GUIDE-005
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 1.6
> **Last Updated:** 2026-05-18
> **Type:** GUIDE

## Version History

| Version | Date       | Author | Change Summary                                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------------------- | --------- | ------ | --------- |
| 1.0     | 2026-02-10 | CMF    | Initial draft (Profile model)                           | —         | Draft  | —         |
| 1.1     | 2026-02-14 | CMF    | Clarify Sources and RSS defaults                        | —         | Draft  | —         |
| 1.2     | 2026-02-14 | CMF    | Update SourceDefaults structure to match schema nesting | —         | Draft  | —         |
| 1.3     | 2026-02-15 | AI     | Restore guide identity and clarify nested sources keys  | —         | Draft  | —         |
| 1.4     | 2026-02-15 | AI     | Assign unique document ID and simplify overview text    | —         | Draft  | —         |
| 1.5     | 2026-05-17 | AI     | Add Error Catalog, Troubleshooting, and Observability   | —         | Draft  | —         |
| 1.6     | 2026-05-18 | AI     | Update starter config to profile-local source overrides | —         | Draft  | —         |

# AIDHA Configuration Guide

## Overview

AIDHA reads settings from a YAML file. You can specify defaults for different environments
(local vs. production) and different ingestion sources. A fixed order decides which value wins.

The config file lives at `.aidha/config.yaml` (per-project) or `~/.config/aidha/config.yaml` (global).

### Key Concepts

1. **Profiles**: Named sets of overrides (e.g., `local`, `production`).
2. **Sources**: Defaults that apply only when a specific ingestion source is active.
3. **Resolution**: Values are merged from 5 tiers (CLI -> Profile -> Source -> Default -> Hardcoded).

## Configuration File Locations

AIDHA searches for a configuration file in the following order:

1. `--config <path>` (CLI flag)
2. `AIDHA_CONFIG` (Environment variable)
3. `.aidha/config.yaml` (Project root)
4. `$XDG_CONFIG_HOME/aidha/config.yaml` (User global)
5. `~/.config/aidha/config.yaml` (Fallback)

If no file is found, AIDHA runs with safe defaults.

## Configuration Structure

A typical config file looks like this:

```yaml
config_version: 1
default_profile: local

profiles:
  local:
    llm:
      model: gpt-4o-mini
    source_overrides:
      youtube:
        youtube:
          debug_transcript: true
    # Optional: add other profile-level overrides here.
```

## Profiles

Profiles are named sets of configuration. You can switch profiles using the `--profile` flag.

```bash
aidha ingest video ... --profile production
```

The `default_profile` key in your config file determines which profile is active if `--profile` is omitted.

## Sources

**Sources** are the highest level of default configuration (Tier 3).

Source-specific profile overrides live under `profiles.<name>.source_overrides.<source-id>`.
They are applied when the matching source is active and are the supported place for
source-private settings such as YouTube cookies and yt-dlp options.

## Precedence

Configuration is resolved in this order (highest priority wins):

1. **CLI Flags**: `--model gpt-4` (Tier 1)
2. **Selected Profile**: `--profile production` (Tier 2)
3. **Source Defaults**: `sources.<id>` / source registration defaults (Tier 3)
4. **Default Profile**: `profiles.default` (Tier 4)
5. **Hardcoded Defaults**: System baselines (Tier 5)

## Managing Secrets

**NEVER commit secrets (API keys, cookies) to `config.yaml`.**

Instead, use environment variable interpolation:

```yaml
profiles:
  default:
    llm:
      api_key: ${AIDHA_LLM_API_KEY}
    source_overrides:
      youtube:
        youtube:
          cookie: ${YOUTUBE_COOKIE}
```

You can set these variables in your shell
or use a `.env` file if you configure `env.dotenv_files` in your config.
Each entry must be a string path; malformed entries fail validation, and
dotenv paths stay confined to `base_dir_prelim`.

## Verification

To see the currently resolved configuration:

```bash
aidha config show
```

To explain where a value is coming from:

```bash
aidha config explain llm.model
```

To compare two profiles:

```bash
aidha config diff local production
```

## Error Catalog

| Error | Trigger | User Remediation |
| ----- | ------- | ---------------- |
| `ConfigNotFoundError` | Explicit `--config` path does not exist. | Fix the path or create the file with `aidha config init`. |
| `ConfigParseError` | YAML is malformed. | Fix the YAML at the reported line/path. |
| `ConfigValidationError` | Config fails schema validation. | Correct the reported key, type, or unknown property. |
| `ConfigVersionError` | `config_version` is unsupported. | Upgrade the binary or generate a new config. |
| `ConfigReadOnlyError` | Write attempted while `AIDHA_CONFIG_READONLY=1`. | Disable read-only mode to allow writes. |
| `ConfigConflictError` | File changed since it was last read. | Re-run the command or use `--force`. |

## Troubleshooting

| Symptom | Likely Cause | First Action |
| ------- | ------------ | ------------ |
| Env var not picked up | Active profile doesn't reference it. | Run `aidha config explain <key>`. |
| Profile ignored | `--profile` or `default_profile` incorrect. | Run `aidha config show --json`. |
| Secrets in output | Redaction metadata missed a key. | Report as security bug; use `isSecretKey`. |

## Observability

AIDHA emits structured log events during configuration loading. These events are redacted and safe
for debugging.

- `config.load.summary`: Emitted after successful resolution. Includes profile, source, and count of
  overrides.
- `config.load.warning`: Emitted for non-fatal issues like file permissions or missing `.env` files.
