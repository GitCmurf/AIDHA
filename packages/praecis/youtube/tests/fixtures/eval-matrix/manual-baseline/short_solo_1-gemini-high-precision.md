---
snapshot_id: short_solo_1-gemini-high-precision
video_id: short_solo_1
provider: Gemini (Gemini 2.5 Pro web UI)
mode: high-precision
prompt_template: prompt-template-high-precision.md
temperature: not-exposed
date: 2026-05-14
---

# Manual Baseline Snapshot

**Video:** short_solo_1 — Nutrition Solo (synthetic)
**Provider:** Gemini 2.5 Pro (web UI)
**Mode:** high-precision
**Transcript used:** `tests/fixtures/eval-matrix/transcript-excerpts/short_solo_1.json`

## Transcript Input (pasted verbatim)

Welcome back to the channel. Today I want to tell you that eating 50 grams of protein after a workout increases muscle synthesis by 20%. This is based on a new study from the University of Muscle. Don't forget to like and subscribe.

## Extracted Claims

1. Eating 50 grams of protein after a workout increases muscle synthesis by 20%.

## Excluded Content

- "Welcome back to the channel." — boilerplate greeting.
- "This is based on a new study from the University of Muscle." — source attribution without specific study details; treated as insufficient evidence to include as a standalone claim.
- "Don't forget to like and subscribe." — call-to-action.

## Observations

High-precision mode excluded the source-attribution sentence (claim 2 in high-recall). This mirrors editorial-pass filtering behavior: the harness also drops source attributions that lack study metadata (DOI, journal, year). This is the primary systematic delta for this excerpt.
