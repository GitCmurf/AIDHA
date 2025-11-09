---
document_id: AIDHA-GOV-001
owner: Repo Maintainers
status: Draft
version: '1.3'
last_updated: 2026-02-24
title: Repository Document Standards
type: GOV
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-001
> **Owner:** Repo Maintainers
> **Status:** Draft
> **Version:** 1.3
> **Last Updated:** 2026-02-24
> **Type:** GOV

# Repository Document Standards (v1.3)

These standards implement the organisation-wide **DocOps Constitution v2.0** for this repository.

## Version History

| Version | Date       | Author | Change Summary                              | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------------------------- | --------- | ------ | --------- |
| 1.0     | 2025-12-27 | CMF    | Adopt Meminit governance baseline           | —         | Draft  | —         |
| 1.1     | 2025-12-27 | CMF    | Add required Version History for validation | —         | Draft  | —         |
| 1.2     | 2026-02-22 | CMF    | Document meminit local install guidance     | —         | Draft  | —         |
| 1.3     | 2026-02-24 | AI     | Align TASK status guidance with meminit schema validation | — | Draft | — |

---

## 1. Automation & Tooling

The validation of these standards is automated via the `meminit` CLI.

* `meminit check`: Validates directory structure, filenames, and frontmatter.
* `meminit fix`: Automatically corrects common violations (e.g., filenames, missing/invalid required
  frontmatter fields).

For repo-local reproducibility, install `meminit` into the project virtual environment and ensure
`./.venv/bin` resolves before global tools when running DocOps checks.

Example:
`pip install "git+https://github.com/GitCmurf/meminit.git@v0.2.0"`

Failures in `meminit check` will block commits via pre-commit hooks.

---

## 2. Repository Prefixes

AIDHA is a monorepo.
All document IDs in this *central* repository MUST begin with:

`AIDHA`

Format: `REPO-TYPE-SEQ` (e.g., `AIDHA-ADR-001`).
Note: `AREA` is a metadata tag, not part of the ID.

Example:
`AIDHA-ADR-001`

Package documents should use package-specific prefixes:
`RECON`
`PHYLA`
`PRAECIS`

---

## 3. AREA Registry

Valid AREA identifiers for this repository:

* `CORE` (Core logic, config, main CLI)
* `CLI` (Command line interface layer)
* `API` (API definitions)
* `AUTH` (Authentication & Authorization)
* `INGEST` (Data Ingestion)
* `DOCS` (Documentation specific logic)
* `AGENT` (Agent interaction layer)

Rules:

* Uppercase
* ASCII only
* Stable over time
* Coarse-grained domains

---

## 4. Allowed Document Types

This repository supports the document types defined in the Constitution.
Common types expected here:

* `gov` (Governance)
* `template` (Templated outlines for governed document types)
* `rfc` (RFCs)
* `STRAT` (Strategy)
* `plan` (Plans)
* `prd` (Product Requirements)
* `research` (Research)
* `spec` (Specs)
* `adr` (Decision Records)
* `task` (Tasks)
* `guide` (Guides/Runbooks)
* `ref` (Reference)
* `log` (Logs)

---

## 5. Directory Structure for This Repository

This repository MAY contain the following structure (only directories that are used need to exist):

```text
docs/
  00-governance/  # GOV, RFC
  00-governance/templates/  # TEMPLATES
  01-indices/
  02-strategy/    # STRAT
  05-planning/    # PLAN, TASK
  08-security/    # GOV, GUIDE
  10-prd/         # PRD, RESEARCH
  20-specs/       # SPEC
  30-design/      # DESIGN
  40-decisions/   # DECISION
  45-adr/         # ADR
  50-fdd/         # FDD
  52-api/         # SPEC
  55-testing/     # TESTING
  58-logs/        # LOG
  60-runbooks/    # GUIDE
  70-devex/       # REF
  96-reference/   # REF
  99-archive/
```

Only directories that are used need to exist.

---

## 6. Metadata Requirements

All governed documents MUST include:

* Required YAML front matter (Constitution I.1)
* An auto-generated visible metadata block
* A unique Document ID
* Updated version and `last_updated` fields whenever content changes

Sidecar metadata MUST be used for non-Markdown artefacts.

---

## 7. Linking Rules

Documents MUST:

* Reference other docs by **Document ID**
* Use **relative links** within the repository
* Use **absolute GitHub links** across repositories

Example:
`See AIDHA-ADR-001.`
`[Link](../20-adr/adr-001-adopt-meminit-docops.md)`

---

## 8. Workflow Expectations

* Any PR modifying APIs, config, operational behaviour, or user-facing system aspects MUST update docs.
* Documents MUST be created/updated via PR.
* Superseded documents MUST be moved to `99-archive/`.

---

## 8.1 Temporary / WIP Documents (Not Governed)

Some documents are intentionally **temporary** (working notes, scratchpads, in-progress drafts) and
should not be governed by DocOps compliance checks.

Convention:

* Filename prefix `WIP-` indicates the document is **not governed**.
* `WIP-` files SHOULD be gitignored (so they are available locally for agents/humans, but not
  committed).

Tooling behavior:

* `meminit check` MUST skip `WIP-` documents under `docs/`.
* Repositories MAY customize this via `docops.config.yaml` (`excluded_filename_prefixes`).

## 9. Local Extensions

* **Task Files**: Task files (`type: TASK`) are stored in `docs/05-planning/tasks/` and are used to
  track human-AI shared work items. The frontmatter `status` value MUST follow the repository
  schema (e.g., `Draft`, `In Review`, `Approved`, `Superseded`); execution progress should be
  tracked inside the document via checklists.

---
