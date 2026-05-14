---
snapshot_id: short_solo_2-chatgpt-high-recall
video_id: short_solo_2
provider: ChatGPT (GPT-4o)
mode: high-recall
prompt_template: prompt-template-high-recall.md
temperature: not-exposed
date: 2026-05-14
---

# Manual Baseline Snapshot

**Video:** short_solo_2 — Exercise Physiology Solo (synthetic)
**Provider:** ChatGPT (GPT-4o web UI)
**Mode:** high-recall
**Transcript used:** `tests/fixtures/eval-matrix/transcript-excerpts/short_solo_2.json`

## Transcript Input (pasted verbatim)

Today I want to cover three evidence-based principles for improving endurance performance. First, zone two training, which means keeping your heart rate at 60 to 70 percent of maximum, builds mitochondrial density in slow-twitch muscle fibers. Second, progressive overload: increasing weekly volume by no more than 10 percent prevents overuse injuries and allows adaptation. Third, carbohydrate availability during sessions longer than 90 minutes is critical. Consuming 60 grams of carbohydrate per hour sustains performance and delays glycogen depletion. Studies show athletes who follow all three principles improve VO2 max by 8 to 12 percent over a 12-week training block.

## Extracted Claims

1. Zone two training keeps heart rate at 60 to 70 percent of maximum.
2. Zone two training builds mitochondrial density in slow-twitch muscle fibers.
3. Increasing weekly training volume by no more than 10 percent prevents overuse injuries.
4. A maximum 10 percent weekly volume increase allows physiological adaptation.
5. Sessions longer than 90 minutes require carbohydrate availability for sustained performance.
6. Consuming 60 grams of carbohydrate per hour during exercise delays glycogen depletion.
7. Athletes who follow all three principles (zone two, progressive overload, carbohydrate timing) improve VO2 max by 8 to 12 percent over a 12-week block.

## Excluded Content

- "Today I want to cover three evidence-based principles for improving endurance performance." — framing/intro sentence; no assertive content.

## Observations

High-recall mode split claim 1 and claim 2 from the same sentence ("zone two training... builds mitochondrial density"). The harness typically merges these into one compound claim. Claims 3 and 4 are also split from the same sentence. The harness produces fewer, denser claims due to editorial consolidation.
