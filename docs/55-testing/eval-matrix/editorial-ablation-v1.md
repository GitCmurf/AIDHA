---
document_id: AIDHA-EVAL-ABLATION-001
owner: Ingestion Engineering Lead
status: Draft
version: "1.0"
last_updated: 2026-05-14
title: Editorial Ablation v1 — raw vs editorial-pass-v1 Delta Comparison
type: EVAL
docops_version: "2.0"
---

<!-- markdownlint-disable MD013 -->

> **Document ID:** AIDHA-EVAL-ABLATION-001
> **Owner:** Ingestion Engineering Lead
> **Status:** Draft
> **Version:** 1.0
> **Last Updated:** 2026-05-14
> **Type:** EVAL

# Editorial Ablation v1 — raw vs editorial-pass-v1

## Version History

| Version | Date | Author | Change Summary | Status |
| ------- | ---- | ------ | -------------- | ------ |
| 1.0 | 2026-05-14 | AI-assisted | Initial write-up with methodology and expected delta patterns. | Draft |

## Purpose

This report documents the quality trade-offs introduced by the `editorial-pass-v1` extractor variant relative to the `raw` (no-editorial) baseline. It answers: "What does editorial filtering gain and lose on average across the evaluation corpus?"

The write-up uses the systematic delta patterns identified in the manual baseline analysis (`tests/fixtures/eval-matrix/manual-baseline/systematic-delta-analysis.md`) as a priori expectations, and is intended to be updated once a live ablation run is completed.

## Methodology

- **Corpus:** `tests/fixtures/eval-matrix/corpus.json` (5 synthetic videos)
- **Models:** All models registered in `model-registry.ts` with `tier: "midtier" | "budget"`
- **Variants compared:** `raw` (base) vs `editorial-pass-v1` (compare)
- **Scoring:** LLM-as-judge via `scoring-executor.ts`; judge model: `gpt-4o-mini`
- **Delta metric:** `compare − base` per dimension (positive = editorial improves the dimension)
- **Infrastructure:** `VariantDeltaResult` from `src/eval/variant-delta.ts`; surfaced in `MatrixReport.variantDeltaSummary`

**Run command:**

```bash
pnpm -C packages/praecis/youtube cli eval matrix \
  --corpus tests/fixtures/eval-matrix/corpus.json \
  --tier midtier \
  --variants raw,editorial-pass-v1 \
  --judge-models gpt-4o-mini \
  --format both \
  --output-dir out/eval-matrix/ablation-v1
```

The resulting `variantDeltaSummary` block in the JSON report is the authoritative source of truth.

## Expected Delta Patterns

Based on the manual baseline systematic delta analysis, `editorial-pass-v1` is expected to show:

| Dimension | Expected Δ Direction | Mechanism |
| --- | --- | --- |
| Completeness | ≤ 0 (slight decrease) | Source attributions and mechanism frames are dropped |
| Accuracy | ≥ 0 (slight increase) | Hedged and speculative claims filtered out |
| Topic Coverage | ≈ 0 | No systematic bias toward or against topic areas |
| Atomicity | ≥ 0 (increase) | Compound claim consolidation reduces redundancy |
| Overall Score | ≈ 0 | Gains and losses approximately cancel |

**Missing claims Δ:** Expected slightly positive (editorial-pass-v1 produces more missing claims, reflecting its higher filtering threshold).

**Hallucinations Δ:** Expected ≤ 0 (editorial-pass-v1 filters uncertain content, which reduces hallucination risk).

## Variant Delta Summary (to be updated after live run)

> **Note:** The table below will be populated from the `variantDeltaSummary` block in the JSON report output after running the command above.

| Dimension | Δ Mean (editorial-pass-v1 − raw) |
| --- | --- |
| Completeness | _TBD_ |
| Accuracy | _TBD_ |
| Topic Coverage | _TBD_ |
| Atomicity | _TBD_ |
| Overall Score | _TBD_ |

**Missing claims Δ:** _TBD_ (positive = editorial-pass-v1 has more missing claims)

**Hallucinations Δ:** _TBD_ (positive = editorial-pass-v1 introduces more hallucinations)

## Default Model Recommendation

To be completed after the live ablation run. Decision criteria:

- If **Atomicity Δ > 0** and **Completeness Δ > −1.5**: Use `editorial-pass-v1` as the default variant. The precision gain outweighs the recall cost.
- If **Completeness Δ < −2.0**: Consider `raw` as default and investigate which claim categories are being over-filtered. Cross-reference with `systematic-delta-analysis.md` to identify the filter rule responsible.

## Acceptance Criteria (Protected by Tests)

The following tests and fixtures verify the behavior described in this report. All must pass for the variant-delta pipeline to be considered correct.

| Test / Fixture | What it checks |
| --- | --- |
| `tests/eval/variant-delta.test.ts` | `computeVariantDelta` matched-pair counting, delta sign (compare − base), zero-delta fallback when no pairs match, `meanMissingClaimsDelta`, `meanHallucinationsDelta`, and cells-without-scores exclusion. Uses `VariantDeltaResult` as the authoritative result symbol. |
| `tests/eval/calibration-record-fixture.test.ts` | `calibration-record-v1.json` validates against `CalibrationRecordSchema`; `goldSetVideoIds` are a subset of `golden-annotations.json` entries; `overallPassed` is consistent with the runner's aggregate-dimension formula. |
| `tests/fixtures/eval-matrix/` | Corpus and annotation fixtures that feed the `pnpm -C packages/praecis/youtube cli eval matrix` command. |
| `MatrixReport.variantDeltaSummary` | Produced by `aggregateMatrixResults` in `src/eval/matrix-aggregator.ts`; variant pairs are derived dynamically from cell data so new extractor variants are picked up automatically. |

**Integration command (produces authoritative JSON output):**

```bash
pnpm -C packages/praecis/youtube cli eval matrix \
  --corpus tests/fixtures/eval-matrix/corpus.json \
  --tier midtier \
  --variants raw,editorial-pass-v1 \
  --judge-models gpt-4o-mini \
  --format both \
  --output-dir out/eval-matrix/ablation-v1
```

The `variantDeltaSummary` block in the resulting JSON report is the single source of truth for the delta values in this document.

## Governance

Any live transcript data used to generate the real delta values must not be committed to this repository. Use the synthetic corpus entries only. Record the run ID and output path in a local note for audit purposes. Any snapshot derived from third-party transcript text must be registered in AIDHA-GOV-005 before committing.
