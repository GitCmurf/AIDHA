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
): Promise<Result<ClaimSetScore>> {
  const { system, user } = buildJudgePrompt(transcript, claims, videoContext);

  // First attempt
  const result1 = await executeAndParse(judgeClient, judgeModel, system, user, maxTokens, signal);
  if (result1.ok) {
    result1.value.judgeMeta = {
      judgeModelId: judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION
    };
    return result1;
  }

  // Retry once with error feedback
  const retryUser = `Your previous response failed JSON schema validation:\n${result1.error.message}\n\nReturn ONLY a corrected JSON object matching the schema. Do not include explanatory text.`;

  const result2 = await executeAndParse(judgeClient, judgeModel, system, retryUser, maxTokens, signal);
  if (result2.ok) {
    result2.value.judgeMeta = {
      judgeModelId: judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION
    };
    return result2;
  }

  return { ok: false, error: new Error(`Failed to parse judge score after retry. Last error: ${result2.error.message}`) };
}

async function executeAndParse(
  client: LlmClient,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  signal?: AbortSignal
): Promise<Result<ClaimSetScore>> {
  const llmResult = await client.generate({
    model,
    system,
    user,
    maxTokens,
    temperature: 0.1, // Low temperature for more deterministic scoring
    signal,
    // In a real implementation we would also set responseFormat for models that support it
  });

  if (!llmResult.ok) {
    return llmResult;
  }

  try {
    let text = llmResult.value.trim();
    // Strip markdown code blocks if present
    if (text.startsWith("```json")) {
      text = text.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (text.startsWith("```")) {
      text = text.replace(/^```/, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(text);
    const validated = ClaimSetScoreSchema.parse(parsed);
    return { ok: true, value: validated };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
