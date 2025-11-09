---
document_id: AIDHA-GUIDE-005
owner: Repo Maintainers
status: Draft
last_updated: 2026-02-15
version: "1.4"
title: AIDHA Configuration Guide
type: GUIDE
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-GUIDE-005
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 1.4
> **Last Updated:** 2026-02-15
> **Type:** GUIDE

## Version History

| Version | Date       | Author | Change Summary                                          | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------------------- | --------- | ------ | --------- |
| 1.0     | 2026-02-10 | CMF    | Initial draft (Profile model)                           | —         | Draft  | —         |
| 1.1     | 2026-02-14 | CMF    | Clarify Sources and RSS defaults                        | —         | Draft  | —         |
| 1.2     | 2026-02-14 | CMF    | Update SourceDefaults structure to match schema nesting | —         | Draft  | —         |
| 1.3     | 2026-02-15 | AI     | Restore guide identity and clarify nested sources keys  | —         | Draft  | —         |
| 1.4     | 2026-02-15 | AI     | Assign unique document ID and simplify overview text    | —         | Draft  | —         |

# AIDHA Configuration Guide

## Overview

AIDHA reads settings from a YAML file. You can specify defaults for different environments
(local vs. production) and different sources (YouTube vs. RSS). A fixed order decides which
value wins.

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
    # Optional: Profile-specific source overrides
    youtube:
      # The outer "youtube" is the source name. The inner "youtube" is the settings for that source.
      youtube:
        debug_transcript: true

  production:
    llm:
      model: gpt-4-turbo
    db: ./prod.sqlite

sources:
  # Tier 3: Defaults applied when 'rss' source is active
  rss:
    # The outer "rss" is the source name. The inner "rss" is the settings for that source.
    rss:
      poll_interval_minutes: 60

  youtube:
    # The outer "youtube" is the source name. The inner "youtube" is the settings for that source.
    youtube:
      cookie: ${YOUTUBE_COOKIE}
```

## Profiles

Profiles are named sets of configuration. You can switch profiles using the `--profile` flag.

```bash
aidha ingest video ... --profile production
```

The `default_profile` key in your config file determines which profile is active if `--profile` is omitted.

## Sources

**Sources** are the highest level of default configuration (Tier 3).

When a source is active (e.g., via `--source rss`),
AIDHA automatically applies defaults defined in the `sources` block of your config file.

```yaml
sources:
  rss:
    # Outer key = source name, inner key = settings for that source.
    rss:
      poll_interval_minutes: 60
```

These defaults apply _only_ when the corresponding source is active.

## Precedence

Configuration is resolved in this order (highest priority wins):

1. **CLI Flags**: `--model gpt-4` (Tier 1)
2. **Selected Profile**: `--profile production` (Tier 2)
3. **Source Defaults**: `sources.rss` (Tier 3)
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
    youtube:
      cookie: ${YOUTUBE_COOKIE}
```

You can set these variables in your shell
or use a `.env` file if you configure `env.dotenv_files` in your config.

## Verification

To see the currently resolved configuration:

```bash
aidha config show
```

To explain where a value is coming from:

```bash
aidha config explain llm.model
```
