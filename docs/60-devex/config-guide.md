---
document_id: AIDHA-GUIDE-001
owner: Repo Maintainers
status: Draft
last_updated: 2026-02-14
version: "1.0"
title: AIDHA Configuration Guide
type: GUIDE
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-GUIDE-001
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 1.0
> **Last Updated:** 2026-02-14
> **Type:** GUIDE

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 1.1     | 2026-02-14 | AI     | Added Sources documentation.   | —         | Draft  | —         |
| 1.0     | 2026-02-14 | AI     | Initial guide. | —         | Draft  | —         |

# AIDHA Configuration Guide

This guide explains how to configure AIDHA using the configuration file system.

## Overview

AIDHA supports a robust configuration system that allows you to:

- Define persistent settings in a `config.yaml` file.
- Switch between environments (e.g., local vs. production) using **Profiles**.
- Override settings via environment variables (for secrets) and CLI flags.

## Configuration File Locations

AIDHA searches for a configuration file in the following order:

1. `--config <path>` (CLI flag)
2. `AIDHA_CONFIG` (Environment variable)
3. `.aidha/config.yaml` (Project root)
4. `$XDG_CONFIG_HOME/aidha/config.yaml` (User global)
5. `~/.config/aidha/config.yaml` (Fallback)

If no file is found, AIDHA runs with safe defaults.

## Structure

A typical `.aidha/config.yaml` looks like this:

```yaml
config_version: 1
default_profile: local

profiles:
  local:
    llm:
      model: gpt-3.5-turbo
      timeout_ms: 30000
    youtube:
      debug_transcript: true
    ytdlp:
      keep_files: true

  production:
    llm:
      model: gpt-4
    db: ./prod.sqlite
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
    poll_interval_minutes: 60
```

These defaults apply *only* when the corresponding source is active.

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
