---
document_id: AIDHA-GOV-002
owner: DocOps Working Group
approvers: CMF
status: Draft
last_updated: 2025-12-27
version: '0.2'
title: Versioning Practices (Operational Guide)
type: GOV
docops_version: '2.0'
---

# Versioning Practices (Operational Guide)

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-002
> **Owner:** DocOps Working Group
> **Approvers:** CMF
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2025-12-27
> **Type:** GOV
> This document adheres to the standards defined in [Document Standards](gov-001-document-standards.md).

## Version History

| Version | Date       | Author | Change Summary                           | Reviewers | Status | Reference |
|---------|------------|--------|------------------------------------------|-----------|--------|-----------|
| 0.1     | 2025-12-27 | CMF    | Seed versioning guidelines               | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Normalize metadata + add Version History | —         | Draft  | —         |

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
