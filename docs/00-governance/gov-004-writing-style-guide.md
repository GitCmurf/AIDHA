---
document_id: AIDHA-GOV-004
owner: DocOps Working Group
approvers: GitCmurf
status: Draft
version: '0.2'
last_updated: 2025-12-27
title: Writing Style Guide
type: GOV
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-004
> **Owner:** DocOps Working Group
> **Approvers:** GitCmurf
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2025-12-27
> **Type:** GOV

# Writing Style Guide

## Version History

| Version | Date       | Author | Change Summary                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ---------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2025-12-27 | CMF    | Seed writing style guidelines            | —         | Draft  | —         |
| 0.2     | 2025-12-27 | CMF    | Normalize metadata + add Version History | —         | Draft  | —         |

- Commit messages: imperative voice ("Add", "Fix", "Refactor").
- Document change logs: past tense summaries ("Added", "Fixed").
- Prefer short sentences, active voice, and concrete nouns.
- Use inclusive, reader-first language; avoid weasel words (checked by Vale).
- Code/paths/commands in backticks; wrap at ~100 chars for readability.

If `vale` is installed, run `vale docs/` to lint prose locally.
