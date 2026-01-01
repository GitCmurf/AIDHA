---
document_id: AIDHA-ADR-001
owner: Repo Maintainers
status: Draft
version: '0.1'
last_updated: 2025-12-27
title: Adopt Meminit DocOps Constitution v2.0
type: ADR
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-ADR-001
> **Owner:** Repo Maintainers
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2025-12-27
> **Type:** ADR

# ADR: Adopt Meminit DocOps Constitution v2.0

## Context

AIDHA started as an early home for DocOps experiments that later became the separate `Meminit`
project. AIDHA is now adopting **Meminit DocOps Constitution v2.0** as its canonical DocOps standard.

This repo will keep only **repo-specific** governance; organisation-level DocOps documents remain in
the Meminit project and are copied here only when needed for local contributor ergonomics.

## Decision

- Use Meminit DocOps Constitution v2.0 conventions for governed docs under `docs/`.
- Enforce via `meminit` (`doctor`, `check`, `fix`, `migrate-ids`) with safety-first workflows.
- Treat legacy DocOps drafts in AIDHA as obsolete and delete them rather than “grandfathering” them.

## Consequences

- Existing docs are renamed and re-identified into `AIDHA-TYPE-SEQ` IDs.
- Some previously-committed scratch/work-product docs are excluded from governance via `WIP-` prefix.
- Local enforcement configuration is explicit and versioned.

## Local Enforcement

- Repo configuration: `docops.config.yaml`
- Schema enforced by `meminit`: `docs/00-governance/metadata.schema.json`
- Catalog schema (DocOps indexing): `docs/00-governance/catalog.schema.json`

## Version History

| Version | Date       | Author | Change Summary                              | Reviewers | Status | Reference |
|---------|------------|--------|---------------------------------------------|-----------|--------|-----------|
| 0.1     | 2025-12-27 | CMF    | Adopt Meminit DocOps Constitution v2.0       | —         | Draft  | —         |
