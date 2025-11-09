# Document Standards

> **Document ID:** DOC-STANDARDS
> **Owner:** DocOps Working Group
> **Status:** Draft
> **Last Updated:** 2025-11-09

## Version History

| Version | Date       | Author        | Description                                  |
|---------|------------|---------------|----------------------------------------------|
| 0.1     | 2025-11-09 | DocOps Agent  | Initial standards for AIDHA workspace docs   |

## Purpose
These standards apply to every human-readable artifact (PRD, ADR, FDD, runbook, quickstart).
They ensure AI agents and humans can reason about document state, provenance, and workflow.

## Core Principles
1. **Metadata First** – Each document starts with a metadata block listing Document ID, Owner,
   Approvers (if any), Status, and Last Updated.
2. **Version Table** – Maintain a Markdown table capturing Version, Date, Author, Change Summary,
   Reviewers, Status, and optional links to commits/tags. Use past tense in descriptions.
3. **Semantic Versioning** – Use `major.minor` (e.g., `1.0`, `1.1`). Increment MAJOR when scope or
   approvals change. Increment MINOR for additive edits. Patch-level detail belongs in the commit log.
4. **Traceable IDs** – Document IDs follow `<AREA>-<TYPE>-<SEQ?>` (e.g., `GRAPH-PRD`, `INGEST-ADR-001`).
5. **DocOps Coupling** – Every code change affecting behavior must update the corresponding doc and
   version table within the same pull request.

## Metadata Block Template
````markdown
> **Document ID:** [ID]
> **Owner:** [Person/Role]
> **Approvers:** [Names or “—”]
> **Status:** [Draft | In Review | Approved | Published | Superseded]
> **Last Updated:** [YYYY-MM-DD]
````

## Version History Template
````markdown
| Version | Date       | Author  | Change Summary                      | Reviewers | Status     | Reference |
|---------|------------|---------|-------------------------------------|-----------|------------|-----------|
| 0.1     | 2025-11-09 | A. Doe | Initial draft                       | —         | Draft      | —         |
````
*Reference column* may hold commit hashes, tags, or URLs. Populate after merge or leave `—`.

## Document Types
| Type | Document ID Example | Notes |
|------|---------------------|-------|
| Product Requirements Document (PRD) | `GRAPH-PRD` | Must link to active ADR/FDD. |
| Architecture Decision Record (ADR) | `GRAPH-ADR-001` | Follows MADR structure plus metadata. |
| Feature Design Document (FDD) | `INGEST-FDD-001` | Includes API/graph schema outlines. |
| Runbook / Ops Guide | `OPS-RUNBOOK-<pkg>` | Include monitoring & rollback steps. |
| Knowledge Graph Schema | `GRAPH-SCHEMA` | Mirrors JSON-LD exports and tests. |

## Tooling & Workflow
- **Editing:** Use VS Code with `Markdown All in One`, `Markdown Table Prettify`, and `Markdownlint`.
- **Automation:** Add tables via CSV snippets; run `npm exec markdown-table-prettify` (future script TBD).
- **Validation:** Pre-commit hook (planned) ensures metadata + version table exist.
- **RAG Readiness:** Keep headings predictable; avoid inline HTML except for metadata block.

## Status Vocabulary
| Status     | Definition |
|------------|------------|
| Draft      | WIP, not yet shared widely. |
| In Review  | Awaiting feedback/approval. |
| Approved   | Accepted by approvers. |
| Published  | Released to target audience. |
| Superseded | Replaced by a newer document. |

## Linking & References
- Reference other documents via relative links and Document ID mention.
- When superseding, add a sentence at the top: `Superseded by [DOC-ID vX.Y](../path.md)`.
- Include commit/tag references only when unique traceability is necessary (security, compliance).

## Maintenance
- Review this standards file quarterly; log updates in the Version History above.
- Questions or proposals go through the DocOps Working Group via RFC referenced in the Constitution.
