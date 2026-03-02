---
document_id: AIDHA-TASK-003
owner: Ingestion Team
status: Draft
version: "0.2"
last_updated: 2026-03-01
title: Fix Extraction Quality and Provider Flex
type: TASK
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-003
> **Owner:** Ingestion Team
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-03-01
> **Type:** TASK

# Fix Extraction Quality and Provider Flex

## Version History

| Version | Date       | Author | Change Summary                                    | Reviewers | Status | Reference |
| :------ | :--------- | :----- | :------------------------------------------------ | :-------- | :----- | :-------- |
| 0.1     | 2026-03-01 | AI     | Initial task plan based on workplan results.      | —         | Draft  | —         |
| 0.2     | 2026-03-01 | AI     | Align with FDD-004 (Profile-based configuration). | —         | Draft  | FDD-004   |

## 1. Background and Work to Date

### 1.1 Initial Observed Failures

Early attempts to extract high-quality claims from video `h_1zlead9ZU` revealed several systemic
weaknesses:

- **Silent Fallbacks:** The `LlmClaimExtractor` was silently falling back to the
  `HeuristicClaimExtractor` when LLM calls failed (e.g., due to 401 Unauthorized errors). This
  resulted in dossiers containing low-utility fragments like "in the fields of fitness and
  nutrition" instead of semantic assertions.
- **Credential Confusion:** Ambiguity in the configuration hierarchy led to extraction runs being
  executed without valid API keys, even when the system reported a redacted "**\*\*\*\***" key (which
  was a default placeholder in some views).
- **Cache Pollution:** Use of `prompt-version v1` across multiple iterations caused the system to
  report `noop=20` (cache hits) even when logic had changed, masking the fact that the LLM was not
  actually being re-queried.

### 1.2 The "Senior Analyst" Mock Test

To establish a "Goal State" without being blocked by API credentials, a high-resolution mock test
was implemented:

- **Upgraded Schema:** Added `Domain` (e.g., Protein Kinetics) and `Classification`
  (Fact/Mechanism/Opinion) to the graph metadata and dossier rendering.
- **Proven Potential:** By manually injecting the high-resolution extracts (matching Gemini-web
  portal output) into a `MockAnalyst`, we verified that the AIDHA graph and dossier pipeline is
  capable of handling and displaying extremely high-utility information.

### 1.3 Architectural Realignment (FDD-004)

Following the initial fixes, the configuration strategy was realigned with **AIDHA-FDD-004**:

- Moved behavioral parameters (model, reasoning effort) from environment variables to **Profiles**.
- Reserved `.env` strictly for secrets (API keys).
- Hardcoded `gpt-5-mini` as the **Tier 5 fallback** to ensure zero-config functionality while
  encouraging profile use for advanced features.

## 2. Technical Objectives

- Support the **GPT-5 model family** (`gpt-5-mini`, `gpt-5-nano`, `gpt-5.2`).
- Implement **"Thinking Mode"** configurability via the `reasoning_effort` API parameter.
- Enable seamless switching between providers (OpenAI, Google, z.AI, Xiaomi, OpenRouter) using the
  "nearest to task" configuration hierarchy.
- Default the system to `gpt-5-mini` (replacing the deprecated `4o-mini`).

## 3. Atomic Task List

### Phase 1: Configuration Schema & Defaults

- [x] Create `.env.example` with placeholders for all major providers (OpenAI, Google, z.AI, Xiaomi,
      OpenRouter).
- [x] Update `packages/aidha-config/schema/config.schema.json` to include:
  - `llm.reasoning_effort` (enum: none, minimal, low, medium, high, xhigh).
  - `llm.verbosity` (enum: low, medium, high).
- [x] Update `packages/aidha-config/src/defaults.ts` to set `gpt-5-mini` as the default model.
- [x] Update `packages/aidha-config/src/types.ts` to include new LLM parameters.

### Phase 2: LLM Client Upgrades

- [x] Modify `packages/praecis/youtube/src/extract/llm-client.ts`:
  - Update `OpenAiCompatibleClient` to pass `reasoning_effort` and `verbosity` in the request body.
  - Ensure `max_tokens` is updated to the newer `max_output_tokens` if supported by the target
    endpoint.
- [x] Implement provider-specific profiles in `examples/config.example.yaml` showing how to switch
      `base_url` and `api_key` using environment variables.

### Phase 3: Extraction Prompt Hardening

- [x] (Partial) Refactor `LlmClaimExtractor.ts` to use "Senior Analyst" instructions (Senior Analyst
      pass 1 mining).
- [x] (Partial) Expand `ClaimCandidate` interface to include `domain` and `classification`.
- [x] Remove the "Mock Override" from `llm-claims.ts` once real GPT-5 connectivity is verified.
- [x] Add explicit error logging in `LlmClaimExtractor` to prevent silent heuristic fallbacks on
      401/500 errors.

### Phase 4: Validation & Benchmarking

- [x] Perform a "Live" extraction run using a valid `gpt-5-mini` key.
- [ ] Compare utility of `gpt-5-nano` (speed) vs `gpt-5.2` (depth) on the same 10-minute transcript
      chunk.
- [ ] Verify that `reasoning_effort: high` significantly improves "Classification" accuracy for
      complex claims.
