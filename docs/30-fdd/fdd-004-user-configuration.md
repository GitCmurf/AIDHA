---
document_id: AIDHA-FDD-004
owner: Repo Maintainers
status: Draft
version: '0.1'
last_updated: 2026-02-12
title: User Configuration Profiles
type: FDD
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-FDD-004
> **Owner:** Repo Maintainers
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-12
> **Type:** FDD

# FDD 004: User Configuration Profiles

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-12 | AI     | Initial FDD for User Configuration Profiles | — | Draft | — |

## Description

A system for defining, validating, and switching between named configuration sets (profiles) for the
AIDHA CLI. This feature allows users to manage complex configurations (database paths, LLM settings,
ingestion parameters) in a persistent file rather than relying on ephemeral environment variables.

## User Story

> As an AIDHA user, I want to switch between a "local dev" profile (using mocks and a test database)
> and a "production" profile (using real APIs and the main database) with a single CLI flag, so that
> I can develop safely without risking production data or incurring API costs.

## Specifications

### 1. Configuration File Discovery

The system searches for a configuration file in the following order:

1. Path specified by `--config <path>` argument.
2. Path specified by `AIDHA_CONFIG` environment variable.
3. `./.aidha/config.yaml` (Project root).
4. `$XDG_CONFIG_HOME/aidha/config.yaml` (User global).
5. `~/.config/aidha/config.yaml` (Fallback).

If no file is found, the system proceeds with hardcoded defaults.

### 2. Profile Structure

The configuration file supports multiple named profiles under a `profiles` key. A schema-defined
`default_profile` key selects the active profile if none is specified.

```yaml
config_version: 1
default_profile: local

profiles:
  local:
    db: ./out/test.sqlite
    youtube:
      ytdlp:
        keep_files: true
    llm:
      model: gpt-3.5-turbo

  production:
    db: ./out/prod.sqlite
    llm:
      model: gpt-4
```

### 3. CLI Integration

Three new global flags are introduced:

- `--config <path>`: Explicitly specify the configuration file to load.
- `--profile <name>`: Activate a specific named profile (overriding `default_profile`).
- `--source <id>`: Apply defaults specific to an ingestion source (e.g., `youtube`).

### 4. Precedence Logic

The final `ResolvedConfig` is computed by merging configuration layers from lowest to highest
priority:

1. **Schema Defaults**: Hardcoded values in the codebase.
2. **Default Profile**: Values from the profile named in `default_profile`.
3. **Source Defaults**: Values from the `defaults` block of the active source (if applicable).
4. **Selected Profile**: Values from the profile selected via `--profile` or `default_profile`.
5. **CLI Overrides**: Explicit command-line flags (e.g., `--db`) and legacy environment variables.

### 5. Validation

The configuration file is validated against a strict JSON Schema.

- **Unknown Keys**: Rejected with a helpful error message.
- **Type Mismatches**: Rejected (e.g., providing a string for a number field).
- **Required Fields**: Enforced as per schema.

## References

- [Plan 005: User Configuration Profiles](../05-planning/plan-005-user-configuration-profiles.md)
- [ADR 008: Configuration Management System](../20-adr/adr-008-configuration-management.md)
