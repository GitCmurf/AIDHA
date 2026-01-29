---
document_id: AIDHA-STRAT-001
owner: Product
status: Draft
version: "1.1"
last_updated: 2026-01-29
title: Minimum End-to-End Vertical Slice
type: STRAT
docops_version: "2.0"
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-STRAT-001
> **Owner:** Product
> **Approvers:** —
> **Status:** Draft
> **Version:** 1.1
> **Last Updated:** 2026-01-29
> **Type:** STRAT

# Strategy: Minimum End-to-End Vertical Slice

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| :------ | :--------- | :----- | :------------- | :-------- | :----- | :-------- |
| 1.0     | 2026-01-27 | AI     | Initial Draft  | —         | Draft  | —         |
| 1.1     | 2026-01-29 | AI     | Add metadata   | —         | Draft  | —         |

## Context

Proving the workflow value proposition with the smallest valid sequence.

## Objective

Deliver a minimal end-to-end vertical slice that demonstrates real value without
requiring a graphical user interface (UI). The goal is to prove the core
"avoid having the same idea again" workflow.

## Scope: The "Build Order"

This sequence represents the smallest set of operations required to validate the system.

### 1. Ingestion

- **Input:** Single video file.
- **Action:** Create a `Resource` node.
- **Output:** Generate a transcript for the video.

### 2. Heuristic Claim Generation (Stub for LLM)

- **Process:** Chunk the transcript.
- **Logic:** Select top sentences using a heuristic (e.g., TF-IDF-ish scoring) to proxy
  for future LLM extraction.
- **Output:** Generate exactly 10 distinct claims.

### 3. Graph Construction

- **Excerpt Nodes:** Create `Excerpt` nodes representing the evidence spans in the source text.
- **Claim Nodes:** Create `Claim` nodes linked to `Excerpt` nodes via `derivedFrom`.
- **Project Assignment:** Assign all created claims to `Project=inbox` (or a
  user-specified project).

### 4. Output: Markdown Dossier

Emit a Markdown formatted dossier containing:

- A bulleted list of claims.
- Each bullet point includes:
  - A timestamped link to the source.
  - The `Excerpt` text.
- A list of extracted references.

### 5. Retrieval Interface (CLI)

Implement a basic CLI command for retrieval to close the loop:

- **Command:** `query --project inbox --tag <x>` (or `--contains "phrase"`)
- **Success Criteria:** The command validates that stored claims can be retrieved,
  satisfying the user need even with a naive implementation.

## Key Principles

- **Determinism:** Maintain determinism as a quality gate for all exports (e.g., JSON-LD).
- **Value Focus:** Prioritize the workflow proof over UI polish.
