---
document_id: AIDHA-PLAN-009
owner: Product
status: Draft
version: "0.1"
last_updated: 2026-06-11
title: Claim Quality Confidence Gates
type: PLAN
docops_version: "2.0"
area: CORE
keywords: [claims, extraction, quality, confidence, graph]
related_ids: [AIDHA-PLAN-004, AIDHA-PLAN-008, AIDHA-GUIDE-004, AIDHA-TASK-011]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-PLAN-009
> **Owner:** Product
> **Approvers:** -
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-06-11
> **Type:** PLAN

# Claim Quality Confidence Gates

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-06-11 | AI     | Define the source-faithful claim contract, quality gate, and model-evaluation path after private pilot extraction failures. | - | Draft | AIDHA-TASK-011 |

## Purpose

AIDHA should not populate trusted graph surfaces with claims that merely sound plausible.
The private YouTube pilot exposed a dangerous failure mode: extracted claims can be polished, domain-labeled, and timestamped while still being poorly written or not faithfully entailed by the source.

This plan makes claim confidence explicit. LLM extraction may create reviewable draft candidates, but those candidates are not trusted graph knowledge unless they pass quality gates or a human accepts them.

## Current Diagnosis

The 2026-06 private pilot output showed these failure classes:

- **Domain drift:** a personal knowledge management video produced neuroscience, cognitive-science, and metabolism labels.
- **Unsupported inference:** claims inferred working-memory or metabolic consequences that the source did not assert.
- **Weak prose:** claims were over-polished, indirect, or framed as broad insights instead of source propositions.
- **Missing support:** `supportSummary` and `rationale` were parsed by extraction but not carried into persisted draft metadata.
- **Prompt leakage from legacy defaults:** generic extraction still used a legacy physiology-oriented prompt unless a newer prompt version was explicitly selected.
- **Category-soup claims:** backlink, tag, or tool lists could be promoted into claims without a meaningful asserted relationship.

The root issue is not just model quality. The system needs a claim-quality contract, deterministic gates, and model-comparison evidence before graph population can be treated as reliable.

## Claim Quality Contract

Each LLM-extracted claim candidate must satisfy these minimum rules:

- The claim is a standalone proposition entailed by the cited source excerpt.
- The domain label matches the source topic; it must not import an unrelated academic or clinical frame.
- `supportSummary` names concrete source support, not a box-ticking phrase.
- Recommendations, warnings, tradeoffs, and scale limits include a `rationale`.
- Claims with reported-speech wrappers are rewritten or rejected.
- Tool, tag, backlink, or category lists are rejected unless the source asserts a workflow, relationship, tradeoff, or recommendation.
- Every candidate carries local excerpt provenance before external URLs.
- Automatic LLM extraction sets `trusted=false`; trust is reserved for human acceptance or a later stronger verifier.

## Confidence Gate

The first implementation is a deterministic gate, not a replacement for human review. It assigns:

- `qualityStatus`: `pending | reviewable | accepted | rejected`.
- `trusted`: boolean, defaulting to `false` for LLM extraction.
- `qualityReasons`: failure reasons such as `missing_support`, `unsupported_inference`, `domain_drift`, `reported_speech`, `category_soup`, `weak_rationale`, and `poor_prose`.
- `qualityScore`: a coarse numeric aid for ordering and diagnostics.
- `supportCoverage`: a lexical support measure against cited excerpts.

Rejected candidates may remain diagnostically visible, but they must not be promoted into `sourceSynopsis` or treated as trusted knowledge.

## Model Evaluation Policy

Routine claim-quality testing should compare:

- `gpt-5.4-mini` as the assumed production candidate.
- `gpt-5.4-nano` as the cost-down candidate.
- `gemini-3.5-flash` as cross-provider comparison.

Use `gpt-5.5` only as a capability-ceiling diagnostic. Use `gpt-5.5-pro` only by deliberate approval for tiny oracle or golden-example generation.

## Acceptance Bar

Before a source family can populate trusted graph surfaces by default:

- At least 80% of `reviewable` candidates in the pilot set are judged source-entailed.
- Zero unsupported inferences are accepted automatically.
- 100% of reviewable candidates have local transcript or source anchors.
- Recommendations have an explicit source-backed reason, condition, or limitation.
- Private pilot failures are converted into general regression tests, not video-specific rewrites.

## Implementation Reference

AIDHA-TASK-011 contains the coding-agent task plan for this plan.
