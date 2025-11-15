---
document_id: VERSIONING-PRACTICES
owner: DocOps Working Group
approvers: CMF
status: Draft
last_updated: 2025-11-12
version: 0.1
type: governance
---

# Versioning Practices (Operational Guide)

> **Document ID:** VERSIONING-PRACTICES
> **Owner:** DocOps Working Group
> **Approvers:** CMF
> **Status:** Draft
> **Last Updated:** 2025-11-12
> **Version:** 0.1  

Refer to [DOC-STANDARDS](../00-governance/Document_Standards.md) for definitions.
This guide describes *when and how* to update version metadata.

1. **Minor change (x.y → x.y+1)**  
   Grammar, clarity, or additive notes.  
   Update the YAML `version`, `last_updated`, and append a row to Version History.

2. **Major change (x.y → x+1.0)**  
   Scope change, new approval cycle, or structural rewrite.  
   Notify approvers and create a new “Approved” version entry.

3. **Supersession**  
   When replaced, mark old doc’s Status as `Superseded` and link to the new one at the top.

4. **Commit Discipline**  
   The version table update and the content change must be in the same commit or PR.
