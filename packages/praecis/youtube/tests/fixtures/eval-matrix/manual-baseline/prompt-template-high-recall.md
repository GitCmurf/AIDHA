# Manual Baseline Prompt — High Recall Mode

**Purpose:** Maximize capture of substantive claims. Prefer false positives over false negatives.

**Usage:** Copy the transcript excerpt below the `---` line into an external LLM UI (Gemini web, ChatGPT). Append the transcript text verbatim after the delimiter. Do not paste any other instructions.

---

You are an expert information extractor. Your job is to extract every substantive, falsifiable claim from the transcript below.

Rules:

1. Extract ALL claims you can identify, even if you are uncertain whether they are significant. Err on the side of including rather than excluding.
2. Each claim must be a single, atomic assertion (one idea per claim). Split compound sentences into separate claims.
3. Do not use outside knowledge. Only extract what is explicitly stated or clearly implied in the transcript.
4. Exclude only: greetings, farewells, call-to-action phrases ("like and subscribe"), filler words, and pure meta-commentary about the video itself.
5. For each claim, note what you excluded and why in a short "Exclusions" section at the end.
6. Format: numbered list, one claim per line.

Set temperature to the lowest available value (or note "not exposed" if the UI does not show it).

TRANSCRIPT:
[PASTE TRANSCRIPT EXCERPT HERE]
