---
document_id: ORG-DOCOPS-CONSTITUTION
owner: DocOps Working Group
approvers: GitCmurf
status: Approved
version: 1.3
last_updated: 2025-11-18
type: governance
docops_version: 1.3
---
> **Document ID:** ORG-DOCOPS-CONSTITUTION  
> **Owner:** DocOps Working Group  
> **Approvers:** GitCmurf
> **Status:** Approved  
> **Version:** 1.3  
> **Last Updated:** 2025-11-18

# DocOps Constitution v1.3

## Preamble
This Constitution defines mandatory organisation-wide rules governing technical documentation.  
Its goals are: consistency across repositories, machine-readability, toolability, long-term maintainability, and predictable structure.  
Repository-level standards MAY extend this Constitution but MUST NOT contradict it.

## Definitions
**Governed Document**  
Any Markdown or text document under `docs/` except ephemeral build artefacts.  
READMEs and code comments are not governed unless explicitly stated.

**Sidecar Metadata File**  
A `.meta.yaml` file that stores metadata for non-Markdown artefacts.

---

# Article I — Canonical Metadata

## I.1 Required YAML Front Matter
Every governed document MUST begin with YAML front matter containing:

```yaml
document_id: <ID>            # e.g., OZYS-INGEST-ADR-001
owner: <Person or Role>
approvers: <List or "—">
status: <Draft|In Review|Approved|Published|Superseded>
last_updated: <YYYY-MM-DD>
version: <MAJOR.MINOR>
type: <prd|adr|fdd|design|spec|decision|runbook|testing|planning|strategy|governance|index>
docops_version: <Constitution version>
```
Additional metadata keys MAY be included for knowledge-graph ingestion or automated tooling.

I.2 Visible Metadata Block

A visible metadata block MUST appear immediately below the YAML.
It MUST be machine-generated or templated; it MUST NOT be manually duplicated.

I.3 Sidecar Metadata

Files not supporting YAML front matter MUST have <filename>.meta.yaml containing the same fields as I.1.
Ephemeral or generated artefacts MAY be exempt.

Article II — Document Identification
II.1 Format

Document IDs MUST follow:

<REPO_PREFIX>-<AREA>-<TYPE>[-<SEQ>]


<REPO_PREFIX>: Unique per repository.

<AREA>: Domain identifier registered in the repo’s Document Standards.

<TYPE>: Document type from Article I.

<SEQ>: Required for ADRs and FDDs; optional otherwise.

II.2 Requirements

IDs MUST be unique across the organisation via prefixing.

Sequence numbers MUST be zero-padded to three digits when used.

Areas MUST be uppercase ASCII and stable.

Article III — Status Vocabulary

Permitted statuses:

Draft

In Review

Approved

Published (optional)

Superseded

Superseded documents MUST:

set status: Superseded

include text at the top:

Superseded by <Document ID> v<Version>.

be moved to docs/99-archive/

# Article IV — Versioning
IV.1 Format

Semantic versioning with two levels:

MAJOR.MINOR

IV.2 Rules

Increment MAJOR for scope/structure/approval changes.

Increment MINOR for additive or clarifying changes.

Status changes alone DO NOT require version bumps unless content changes.

last_updated changes ALONE DO NOT increment version.

Article V — Change Control

Git is the canonical version history.

Visual/manual “Version History tables” MUST NOT be used.

The version in metadata MUST be updated with the PR that changes the document.

All governed documents MUST be modified only via PRs.

Article VI — Repository Document Structure

Every repository MUST contain a docs/ directory.
It SHOULD include the following structure; unused directories MAY be omitted:

docs/
  00-governance/
  01-indices/
  02-strategy/
  05-planning/
  10-prd/
  20-specs/
  30-design/
  40-decisions/
  45-adr/
  50-fdd/
  55-testing/
  60-runbooks/
  70-devex/
  99-archive/


Each directory has the meaning defined in the Constitution v1.2.

Article VII — Linking and References

Documents MUST:

Reference other documents by Document ID in prose.

Use relative markdown links for navigation within a repo.

Use absolute GitHub links for cross-repo references.

Example:

See OZYS-INGEST-ADR-003 for rationale.  
[Full link](../45-adr/OZYS-INGEST-ADR-003.md)

Article VIII — Coupling Between Code and Documentation

A PR that changes:

APIs

configuration

input/output formats

behaviour affecting users or operations

system constraints

deployment/operational steps

MUST update the corresponding documents in the SAME PR.

Article IX — Orthography and Filenames

Filenames MUST use ASCII 32–126.

Filenames MUST use American spelling.

Document bodies MAY use British or American spelling, but MUST be internally consistent.

No diacritics in filenames.

Standard files retain canonical names (e.g., LICENSE).

Article X — Local Extensions

Each repo MAY define additional rules in:

docs/00-governance/Document_Standards.md


Local rules MUST NOT contradict this Constitution.

Article XI — Amendment Procedure

Amendments require:

An RFC document (ADR format recommended).

Approval from maintainers of at least two independent repositories.

Version bump and commit of updated Constitution.

