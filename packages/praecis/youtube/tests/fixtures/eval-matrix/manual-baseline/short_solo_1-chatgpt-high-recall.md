---
snapshot_id: short_solo_1-chatgpt-high-recall
video_id: short_solo_1
provider: ChatGPT (GPT-4o)
mode: high-recall
prompt_template: prompt-template-high-recall.md
temperature: not-exposed
date: 2026-05-14
---

# Manual Baseline Snapshot

**Video:** short_solo_1 — Nutrition Solo (synthetic)
**Provider:** ChatGPT (GPT-4o web UI)
**Mode:** high-recall
**Transcript used:** `tests/fixtures/eval-matrix/transcript-excerpts/short_solo_1.json`

## Transcript Input (pasted verbatim)

Welcome back to the channel. Today I want to tell you that eating 50 grams of protein after a workout increases muscle synthesis by 20%. This is based on a new study from the University of Muscle. Don't forget to like and subscribe.

## Extracted Claims

1. Eating 50 grams of protein after a workout increases muscle synthesis by 20%.
2. The 20% muscle synthesis increase is supported by a study from the University of Muscle.

## Excluded Content

- "Welcome back to the channel." — boilerplate greeting; no assertive content.
- "Don't forget to like and subscribe." — call-to-action; not a claim.

## Observations

Both substantive claims were captured. The high-recall mode captured the source attribution as a separate claim (claim 2), which the harness typically merges into the primary claim or omits under editorial-pass filtering.
