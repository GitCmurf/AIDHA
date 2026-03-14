import type { LlmClient } from "../extract/llm-client.js";
import type { ClaimCandidate } from "../extract/types.js";
import type { Result } from "../pipeline/types.js";
import { ClaimSetScoreSchema, type ClaimSetScore } from "./scoring-rubric.js";
import { buildJudgePrompt, JUDGE_PROMPT_VERSION } from "./prompts/judge-claim-quality.js";
import type { VideoContext } from "./matrix-runner.js";

export async function scoreClaimSet(
  judgeClient: LlmClient,
  judgeModel: string,
  transcript: string,
  claims: ClaimCandidate[],
  videoContext: VideoContext,
  maxTokens: number = 4000,
  signal?: AbortSignal
): Promise<Result<{ score: ClaimSetScore; traces: Array<{ prompt: { system: string; user: string }; response: string }> }>> {
  const { system, user } = buildJudgePrompt(transcript, claims, videoContext);
  const traces: Array<{ prompt: { system: string; user: string }; response: string }> = [];

  // First attempt
  const llmResult1 = await judgeClient.generate({
    model: judgeModel,
    system,
    user,
    maxTokens,
    temperature: 0.1,
    signal,
  });

  traces.push({ prompt: { system, user }, response: llmResult1.ok ? llmResult1.value : `Error: ${llmResult1.error.message}` });

  if (!llmResult1.ok) {
    return { ok: false, error: llmResult1.error };
  }

  const result1 = parseAndValidate(llmResult1.value);
  if (result1.ok) {
    result1.value.judgeMeta = {
      judgeModelId: judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION
    };
    return { ok: true, value: { score: result1.value, traces } };
  }

  // Retry once with error feedback - no need to re-send full transcript
  const retryUser = `Your previous response failed JSON schema validation:\n${result1.error.message}\n\nReturn ONLY a corrected JSON object with these fields:
- completeness, accuracy, topicCoverage, atomicity, overallScore (numbers 0-10)
- reasoning (string, min 10 chars)
- missingClaims, hallucinations, redundancies (arrays of {text: string})
- gapAreas (array of {area: string})

Do not include explanatory text.`;

  const llmResult2 = await judgeClient.generate({
    model: judgeModel,
    system,
    user: retryUser,
    maxTokens,
    temperature: 0.1,
    signal,
  });

  traces.push({ prompt: { system, user: retryUser }, response: llmResult2.ok ? llmResult2.value : `Error: ${llmResult2.error.message}` });

  if (!llmResult2.ok) {
    return { ok: false, error: llmResult2.error };
  }

  const result2 = parseAndValidate(llmResult2.value);
  if (result2.ok) {
    result2.value.judgeMeta = {
      judgeModelId: judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION
    };
    return { ok: true, value: { score: result2.value, traces } };
  }

  return { ok: false, error: new Error(`Failed to parse judge score after retry. Last error: ${result2.error.message}`) };
}

function parseAndValidate(content: string): Result<ClaimSetScore> {
  try {
    let text = content.trim();
    // Strip markdown code blocks if present
    if (text.startsWith("```json")) {
      text = text.slice(7); // Remove ```json
      const endIdx = text.lastIndexOf("```");
      if (endIdx !== -1) {
        text = text.slice(0, endIdx);
      }
      text = text.trim();
    } else if (text.startsWith("```")) {
      text = text.slice(3); // Remove ```
      const endIdx = text.lastIndexOf("```");
      if (endIdx !== -1) {
        text = text.slice(0, endIdx);
      }
      text = text.trim();
    }

    const parsed = JSON.parse(text);
    const validated = ClaimSetScoreSchema.parse(parsed);
    return { ok: true, value: validated };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
