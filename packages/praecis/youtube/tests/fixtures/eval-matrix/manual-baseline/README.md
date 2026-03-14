# Manual Baseline Prompt Templates

This directory contains prompt templates for extracting claims directly via external LLM UIs (Gemini web, ChatGPT) as part of the manual baseline procedure documented in `docs/55-testing/eval-matrix/manual-baseline-no-harness.md`.

## Templates

- `prompt-template-high-recall.md` - Prompt designed to maximize claim recall
- `prompt-template-high-precision.md` - Prompt designed to maximize precision

## Usage

1. Copy a transcript excerpt from `../transcript-excerpts/`
2. Paste into the external LLM UI
3. Use the corresponding prompt template
4. Save the response as a snapshot

## Adding New Templates

Add new templates here with descriptive names and update the documentation to reference them.
