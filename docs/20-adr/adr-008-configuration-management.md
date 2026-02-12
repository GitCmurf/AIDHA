---
document_id: AIDHA-ADR-008
owner: Repo Maintainers
status: Approved
version: '0.1'
last_updated: 2026-02-12
title: Configuration Management System
type: ADR
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-008
> **Owner:** Repo Maintainers
> **Status:** Approved
> **Version:** 0.1
> **Last Updated:** 2026-02-12
> **Type:** ADR

# ADR 008: Configuration Management System

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-12 | AI     | Initial ADR for Configuration Management System | — | Accepted | — |

## Status

Accepted

## Context

The AIDHA CLI and ingestion engine relied on an ad-hoc collection of environment variables
(`AIDHA_*`, `YOUTUBE_*`) and CLI flags to configure behavior. This approach scaled poorly:

1. **Discoverability**: Users had to grep source code to find available configuration options.
2. **validation**: Typos in environment variables failed silently.
3. **Profiles**: Switching between environments (e.g., local mock vs. production) required tedious
   shell script management.
4. **Security**: Secrets were scattered across shell histories and `.env` files without a unified
   redaction strategy.
5. **Consistency**: Different modules resolved configuration differently (some favored env vars,
   some favored flags).

## Decision

We decided to implement a dedicated configuration management package, `@aidha/config`, integrated
into the CLI via a bridge adapter.

### Key Architectural Choices

1. **Centralized Schema**: A single JSON Schema defines all configuration keys, types, defaults,
   and validation rules.
2. **Five-Tier Precedence**: Configuration is resolved in a strict order:
   1. **CLI Flags**: Explicit overrides (highest priority).
   2. **Selected Profile**: Named configuration sets within the config file.
   3. **Source Defaults**: Configuration specific to the active ingestion source (e.g., `youtube`).
   4. **Default Profile**: Fallback values from the `default` profile in the config file.
   5. **Hardcoded Defaults**: Schema-defined defaults (lowest priority).
3. **YAML Format**: Configuration files use YAML for human readability, comments, and hierarchical
   structure.
4. **Workspace Dependency**: The config logic is extracted into a standalone package
   (`packages/aidha-config`) to allow reuse across future tools and to enforce separation of
   concerns.
5. **Strict Validation**: The loader rejects unknown keys to prevent typos from causing silent
   configuration drift.

## Consequences

### Positive

- **Improved User Experience**: Users can define persistent profiles and switch between them easily
  with `--profile`.
- **Type Safety**: The system provides a strongly-typed `ResolvedConfig` object at runtime,
  eliminating `process.env` string parsing and casting.
- **Auditability**: The source of every configuration value is traceable (via the `explain` feature).
- **Security**: Secrets can be consistently redacted in logs and outputs.
- **Backward Compatibility**: The implementation supports legacy environment variables as a fallback
  layer (via the CLI bridge) to prevent breaking existing workflows.

### Negative

- **Complexity**: Adds a workspace dependency and a build step for the config package.
- **Rigidity**: Adding a new configuration option requires updating the schema, not just reading a
  new env var. This is intentional to prevent configuration sprawl.

## References

- [Plan 005: User Configuration Profiles](../05-planning/plan-005-user-configuration-profiles.md)
- `packages/aidha-config` (Implementation)
