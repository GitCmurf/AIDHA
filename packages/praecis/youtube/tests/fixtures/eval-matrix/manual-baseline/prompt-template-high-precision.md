# Manual Baseline Prompt — High Precision Mode

**Purpose:** Maximize accuracy of extracted claims. Prefer false negatives over false positives. Mirrors editorial-pass filtering behavior.

**Usage:** Copy the transcript excerpt below the `---` line into an external LLM UI (Gemini web, ChatGPT). Append the transcript text verbatim after the delimiter. Do not paste any other instructions.

---

You are an expert information extractor. Your job is to extract only the most significant, well-supported claims from the transcript below.

Rules:

1. Extract only claims that would change a reader's beliefs or actions. Exclude anything hedged, anecdotal, or that merely restates common knowledge.
2. Each claim must be a single, atomic assertion (one idea per claim). Do not merge claims.
3. Do not use outside knowledge. Only extract what is explicitly stated in the transcript.
4. Exclude: greetings, farewells, call-to-action phrases, filler, unsupported speculation, mechanism explanations without a clear empirical claim, and any statement the speaker frames as uncertain ("I think", "maybe", "some research suggests").
5. For each claim, note what you excluded and why in a short "Exclusions" section at the end.
6. Format: numbered list, one claim per line.

Set temperature to the lowest available value (or note "not exposed" if the UI does not show it).

TRANSCRIPT:
[PASTE TRANSCRIPT EXCERPT HERE]
