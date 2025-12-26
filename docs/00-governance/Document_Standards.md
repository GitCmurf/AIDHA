---
document_id: AIDHA-GOV-STANDARDS
owner: Repo Maintainers
approvers: GitCmurf
status: Draft
version: 1.0
last_updated: 2025-11-18
type: governance
docops_version: 1.3
---
> **Document ID:** AIDHA-GOV-STANDARDS  
> **Owner:** Repo Maintainers  
> **Approvers:** GitCmurf
> **Status:** Draft  
> **Version:** 1.0  
> **Last Updated:** YYYY-MM-DD  

# Repository Document Standards (v1.0)

These standards implement the organisation-wide DocOps Constitution v1.3 for this repository.

---

# 1. Repository Prefix

All document IDs in this repository MUST begin with:
```
AIDHA
```

Example:
```
AIDHA-INGEST-ADR-001
```

---

# 2. AREA Registry

Valid AREA identifiers for this repository (from YAML `areas:`):

- `GOV`  
- `PLAN`  
- `<AREA_3>`  
(Extend as necessary.)

Rules:
- Uppercase  
- ASCII only  
- Stable over time  
- Coarse-grained domains

---

# 3. Allowed Document Types

This repository supports the document types defined in the Constitution.  
Common types expected here:

- `adr`  
- `design`  
- `spec`  
- `runbook`  
- `testing`  
- `decision`  
- `planning`  
- `strategy`  
- `governance`  
- `index`

Additional types MUST be documented and justified.

---

# 4. Directory Structure for This Repository

This repository MUST contain:



docs/
00-governance/
01-indices/
<other-used-directories>
99-archive/


This repository MAY include any additional directories from the full Constitution structure:



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


Only directories that are used need to exist.

---

# 5. Metadata Requirements

All governed documents MUST include:

- Required YAML metadata (Constitution I.1)  
- An auto-generated visible metadata block  
- A unique Document ID  
- Updated version and last_updated fields whenever content changes  

Sidecar metadata MUST be used for non-Markdown artefacts.

---

# 6. Linking Rules

Documents MUST:

- Reference other docs by Document ID  
- Use relative links within the repository  
- Use absolute GitHub links across repositories  

Example:


See <REPO_PREFIX>-INGEST-ADR-003.
Link


---

# 7. Workflow Expectations

- Any PR modifying APIs, config, operational behaviour, or user-facing system aspects MUST update docs.  
- Documents MUST be created/updated via PR.  
- Superseded documents MUST be moved to `99-archive/`.

---

# 8. Local Extensions (Optional)

Local rules may be defined here if needed.  
They MUST NOT contradict the DocOps Constitution (ORG-DOCOPS-CONSTITUTION).

## 8.1 Orthography
- This repository prefers British spelling in document content.  

---
