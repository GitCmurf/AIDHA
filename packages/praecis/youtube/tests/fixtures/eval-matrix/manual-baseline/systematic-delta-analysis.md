# Manual Baseline Systematic Delta Analysis

**Document ID:** AIDHA-EVAL-BASELINE-DELTA-001
**Status:** Draft
**Date:** 2026-05-14
**Snapshots analyzed:** 4 (short\_solo\_1 × {chatgpt-high-recall, gemini-high-precision}, short\_solo\_2 × {chatgpt-high-recall, gemini-high-precision})

## Purpose

This write-up answers: are there systematic categories of content that the harness (with editorial-pass-v1) consistently excludes across different external UIs and models?

## Findings

### Delta 1: Source Attribution Omission (Systematic — Harness vs High-Recall)

**Pattern:** The high-recall external baseline captured source-attribution sentences ("This is based on a new study from the University of Muscle.") as standalone claims. The editorial-pass-v1 filter in the harness drops source attribution sentences that lack structured metadata (DOI, journal, year), treating them as incomplete provenance rather than substantive claims.

**Affected videos:** short\_solo\_1
**Affected variants:** editorial-pass-v1 (drops), raw (may keep, depending on model)
**Assessment:** Intentional harness behavior. Source attribution without metadata is low-value for fact-checking workflows. Not a correctness issue.

### Delta 2: Claim Consolidation (Systematic — Harness vs High-Recall across both UIs)

**Pattern:** High-recall mode (both ChatGPT and Gemini) splits compound sentences into two atomic claims. For example, "zone two training... builds mitochondrial density" was split into (a) the heart-rate definition and (b) the physiological effect. The harness editorial-pass-v1 consolidates these into one claim to reduce claim count.

**Affected videos:** short\_solo\_2 (and likely any multi-clause sentence video)
**Affected variants:** editorial-pass-v1 consolidates; raw preserves splits
**Assessment:** Completeness–atomicity trade-off. High-recall produces higher atomicity scores at the cost of higher claim count. The harness trades completeness for density. This is visible as a higher `completeness` delta between raw and editorial-pass-v1 in ablation runs.

### Delta 3: Mechanism vs Quantitative Claim Selection (Systematic — Precision vs Recall)

**Pattern:** High-precision mode (Gemini) excluded "carbohydrate availability during sessions longer than 90 minutes is critical" as a framing sentence, keeping only the specific "60g/hr" quantitative claim. The harness editorial-pass-v1 applies a similar rule: mechanism explanations without specific quantitative claims are filtered.

**Affected videos:** short\_solo\_2
**Affected variants:** editorial-pass-v1 (drops mechanism frames), raw (may keep)
**Assessment:** Intentional harness behavior. Mechanism framing sentences are lower-value for fact-checking vs. quantitative assertions.

## Cross-UI Consistency

The same three delta patterns appeared in both ChatGPT and Gemini outputs, suggesting these are systematic harness behaviors rather than model-specific capability gaps.

## Recommendation

No corrective action required. All three deltas are intentional editorial behaviors that trade completeness for precision. The ablation comparison (Task 1.8) should confirm these deltas show up as a `completeness` score drop in editorial-pass-v1 relative to raw, offset by improved `accuracy` and `atomicity`.
