---
snapshot_id: short_solo_2-gemini-high-precision
video_id: short_solo_2
provider: Gemini (Gemini 2.5 Pro web UI)
mode: high-precision
prompt_template: prompt-template-high-precision.md
temperature: not-exposed
date: 2026-05-14
---

# Manual Baseline Snapshot

**Video:** short_solo_2 — Exercise Physiology Solo (synthetic)
**Provider:** Gemini 2.5 Pro (web UI)
**Mode:** high-precision
**Transcript used:** `tests/fixtures/eval-matrix/transcript-excerpts/short_solo_2.json`

## Transcript Input (pasted verbatim)

Today I want to cover three evidence-based principles for improving endurance performance. First, zone two training, which means keeping your heart rate at 60 to 70 percent of maximum, builds mitochondrial density in slow-twitch muscle fibers. Second, progressive overload: increasing weekly volume by no more than 10 percent prevents overuse injuries and allows adaptation. Third, carbohydrate availability during sessions longer than 90 minutes is critical. Consuming 60 grams of carbohydrate per hour sustains performance and delays glycogen depletion. Studies show athletes who follow all three principles improve VO2 max by 8 to 12 percent over a 12-week training block.

## Extracted Claims

1. Zone two training (60–70% max HR) builds mitochondrial density in slow-twitch muscle fibers.
2. Increasing weekly training volume by no more than 10 percent prevents overuse injuries and enables adaptation.
3. Consuming 60 grams of carbohydrate per hour during sessions longer than 90 minutes delays glycogen depletion.
4. Following zone two training, progressive overload, and carbohydrate timing together improves VO2 max by 8–12% over 12 weeks.

## Excluded Content

- Framing sentence ("Today I want to cover...") — intro, no content.
- "carbohydrate availability during sessions longer than 90 minutes is critical" — treated as a mechanism framing sentence rather than a standalone falsifiable claim; the specific quantity (60g/hr) was included instead.

## Observations

High-precision mode merges compound sentences into fewer, denser claims (4 vs 7 in high-recall for the same transcript). This mirrors editorial-pass behavior in the harness. The harness also consolidates multi-part sentences into single claims, which is the primary atomicity-vs-completeness trade-off observed.
