import { z } from "zod";
import type { LlmClient } from "../extract/llm-client.js";
import type { ClaimCandidate } from "../extract/types.js";
import type { Result } from "../pipeline/types.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { VideoContext } from "./matrix-runner.js";
import { buildNarrowJudgePrompt, NARROW_JUDGE_PROMPT_VERSION } from "./prompts/judge-narrow-claim-quality.js";

const NarrowJudgeFindingSchema = z.object({
  goldId: z.string().min(1).optional(),
  goldText: z.string().min(1).optional(),
  candidateText: z.string().min(1).optional(),
  reason: z.string().min(3),
  isRoot: z.boolean().optional(),
});

const NarrowJudgeStructuralIssueSchema = z.object({
  issue: z.string().min(1),
  reason: z.string().min(3),
  severity: z.enum(["low", "medium", "high"]),
});

export const NarrowJudgeFindingsSchema = z.object({
  summary: z.string().min(3),
  matchedGoldClaims: z.array(z.object({
    goldId: z.string().min(1).optional(),
    goldText: z.string().min(1),
    candidateText: z.string().min(1),
    reason: z.string().min(3),
  })),
  missedGoldClaims: z.array(NarrowJudgeFindingSchema.extend({
    goldId: z.string().min(1).optional(),
    goldText: z.string().min(1),
  })),
  unsupportedCandidateClaims: z.array(NarrowJudgeFindingSchema.extend({
    candidateText: z.string().min(1),
  })),
  redundantCandidateClaims: z.array(NarrowJudgeFindingSchema.extend({
    candidateText: z.string().min(1),
  })),
  structuralIssues: z.array(NarrowJudgeStructuralIssueSchema),
});

export interface NarrowDerivedJudgeScores {
  goldCoverage: number;
  faithfulness: number;
  structure: number;
  atomicity: number;
  overallScore: number;
}

export type NarrowJudgeFindings = z.infer<typeof NarrowJudgeFindingsSchema>;

export interface NarrowJudgeResult {
  findings: NarrowJudgeFindings;
  derivedScores: NarrowDerivedJudgeScores;
  judgeMeta: {
    judgeModelId: string;
    judgePromptVersion: string;
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function stripCodeFences(content: string): string {
  let text = content.trim();
  const jsonFenceIdx = text.indexOf("```json");
  if (jsonFenceIdx !== -1) {
    text = text.slice(jsonFenceIdx + 7);
    const endIdx = text.lastIndexOf("```");
    if (endIdx !== -1) text = text.slice(0, endIdx);
    return text.trim();
  }
  const fenceIdx = text.indexOf("```");
  if (fenceIdx !== -1) {
    text = text.slice(fenceIdx + 3);
    const endIdx = text.lastIndexOf("```");
    if (endIdx !== -1) text = text.slice(0, endIdx);
    return text.trim();
  }
  // If no fences, try to find the first JSON object/array start
  const jsonStart = text.search(/[\[{]/);
  if (jsonStart !== -1) {
    text = text.slice(jsonStart);
  }
  return text.trim();
}

export function deriveNarrowJudgeScores(
  findings: NarrowJudgeFindings,
  goldClaims: FlattenedGoldenClaimNode[],
  candidateClaims: ClaimCandidate[]
): NarrowDerivedJudgeScores {
  const validGoldIds = new Set(goldClaims.map((c) => c.id));
  const matchedGoldIds = new Set<string>();
  const unmatchedForFallback = [...goldClaims];

  for (const finding of findings.matchedGoldClaims) {
    if (finding.goldId && validGoldIds.has(finding.goldId)) {
      matchedGoldIds.add(finding.goldId);
    } else if (finding.goldText) {
      // Fallback for old caches: match by text, ensuring 1 finding matches at most 1 node
      const idx = unmatchedForFallback.findIndex((c) => c.text === finding.goldText);
      const matchedNode = unmatchedForFallback[idx];
      if (idx !== -1 && matchedNode) {
        matchedGoldIds.add(matchedNode.id);
        unmatchedForFallback.splice(idx, 1);
      }
    }
  }

  const rootIds = new Set(goldClaims.filter((claim) => claim.depth === 0).map((claim) => claim.id));
  const missedRootCount = findings.missedGoldClaims.filter((finding) => {
    if (finding.isRoot) return true;
    if (finding.goldId) return rootIds.has(finding.goldId);
    if (finding.goldText) {
      return goldClaims.some((c) => c.depth === 0 && c.text === finding.goldText);
    }
    return false;
  }).length;

  const candidateCount = Math.max(candidateClaims.length, 1);
  const structuralPenalty = findings.structuralIssues.reduce((sum, issue) => {
    if (issue.severity === "high") return sum + 2;
    if (issue.severity === "medium") return sum + 1;
    return sum + 0.5;
  }, 0);
  const compoundPenalty = findings.structuralIssues.filter((issue) =>
    issue.issue.toLowerCase().includes("compound") || issue.issue.toLowerCase().includes("atomic")
  ).length * 0.5;

  const goldCoverage = clampScore((matchedGoldIds.size / Math.max(goldClaims.length, 1)) * 10);
  const faithfulness = candidateClaims.length === 0
    ? 10
    : clampScore(10 - ((findings.unsupportedCandidateClaims.length / candidateCount) * 10));
  const structure = clampScore(10 - structuralPenalty - (missedRootCount * 1.5));
  const atomicity = candidateClaims.length === 0
    ? 10
    : clampScore(10 - ((findings.redundantCandidateClaims.length / candidateCount) * 10) - compoundPenalty);
  const overallScore = clampScore((goldCoverage + faithfulness + structure + atomicity) / 4);

  return { goldCoverage, faithfulness, structure, atomicity, overallScore };
}

class NarrowJudgeError extends Error {
  readonly traces: Array<{ prompt: { system: string; user: string }; response: string }>;
  constructor(message: string, traces: Array<{ prompt: { system: string; user: string }; response: string }>) {
    super(message);
    this.traces = traces;
  }
}

function parseFindings(content: string): Result<NarrowJudgeFindings> {
  try {
    const parsed = JSON.parse(stripCodeFences(content));
    return { ok: true, value: NarrowJudgeFindingsSchema.parse(parsed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Evaluates a set of candidate claims against a transcript and golden claims.
 *
 * This function uses an AI judge to score the quality of extracted claims based on:
 * - Gold Coverage: How many of the ground-truth (gold) claims were captured.
 * - Faithfulness: Whether the candidate claims are supported by the transcript.
 * - Structure: Whether the claims follow the expected hierarchical/relational format.
 * - Atomicity: Whether the claims are sufficiently granular and non-redundant.
 *
 * @param judgeClient - LLM client instance for making evaluation requests.
 * @param judgeModel - ID of the model to use as a judge.
 * @param transcript - Full transcript text of the video.
 * @param claims - The set of candidate claims extracted by the system under test.
 * @param goldClaims - Ground-truth claims to compare against.
 * @param teacherClaims - Reference claims from a high-quality "teacher" extractor.
 * @param videoContext - Metadata about the video being evaluated.
 * @param maxTokens - Maximum tokens for the judge's response (default: 4000).
 * @param signal - Optional AbortSignal for request cancellation.
 *
 * @returns A Result containing the evaluation findings, derived scores, and execution traces.
 * @throws Never - Returns a failed Result instead of throwing.
 */
export async function scoreNarrowClaimSet(
  judgeClient: LlmClient,
  judgeModel: string,
  transcript: string,
  claims: ClaimCandidate[],
  goldClaims: FlattenedGoldenClaimNode[],
  teacherClaims: ClaimCandidate[],
  videoContext: VideoContext,
  maxTokens: number = 4000,
  signal?: AbortSignal
): Promise<Result<{ result: NarrowJudgeResult; traces: Array<{ prompt: { system: string; user: string }; response: string }> }>> {
  const { system, user } = buildNarrowJudgePrompt(transcript, claims, goldClaims, teacherClaims, videoContext);
  const traces: Array<{ prompt: { system: string; user: string }; response: string }> = [];

  const llmResult1 = await judgeClient.generate({
    model: judgeModel,
    system,
    user,
    maxTokens,
    temperature: 0.1,
    signal,
  });
  traces.push({ prompt: { system, user }, response: llmResult1.ok ? llmResult1.value : `Error: ${llmResult1.error.message}` });
  if (!llmResult1.ok) return { ok: false, error: new NarrowJudgeError(llmResult1.error.message, traces) };

  const parsed1 = parseFindings(llmResult1.value);
  if (parsed1.ok) {
    return {
      ok: true,
      value: {
        result: {
          findings: parsed1.value,
          derivedScores: deriveNarrowJudgeScores(parsed1.value, goldClaims, claims),
          judgeMeta: { judgeModelId: judgeModel, judgePromptVersion: NARROW_JUDGE_PROMPT_VERSION },
        },
        traces,
      },
    };
  }

  const validationIssues =
    parsed1.error instanceof z.ZodError
      ? parsed1.error.issues.map(issue => `  - Path: ${JSON.stringify(issue.path)} — ${issue.message}`).join("\n")
      : parsed1.error.message;

  const retryUser = `Your previous response failed JSON schema validation:
${validationIssues}

Please correct the following evaluation output. You must return ONLY valid JSON that follows the schema exactly.

Required JSON schema:
- summary: string (min 3 chars)
- matchedGoldClaims: array of { goldId?: string, goldText: string (min 1), candidateText: string (min 1), reason: string (min 3) }
- missedGoldClaims: array of { goldId?: string, goldText: string (min 1), reason: string (min 3), isRoot?: boolean }
- unsupportedCandidateClaims: array of { candidateText: string (min 1), reason: string (min 3) }
- redundantCandidateClaims: array of { candidateText: string (min 1), reason: string (min 3) }
- structuralIssues: array of { issue: string (min 1), reason: string (min 3), severity: "low" | "medium" | "high" }

Here is the original task prompt you were given:
---
${user}
---

Previous output to fix:
${llmResult1.value}`;

  const llmResult2 = await judgeClient.generate({
    model: judgeModel,
    system,
    user: retryUser,
    maxTokens,
    temperature: 0.1,
    signal,
  });
  traces.push({ prompt: { system, user: retryUser }, response: llmResult2.ok ? llmResult2.value : `Error: ${llmResult2.error.message}` });
  if (!llmResult2.ok) return { ok: false, error: new NarrowJudgeError(llmResult2.error.message, traces) };

  const parsed2 = parseFindings(llmResult2.value);
  if (!parsed2.ok) {
    return { ok: false, error: new NarrowJudgeError(`Failed to parse narrow judge output after retry. Last error: ${parsed2.error.message}`, traces) };
  }

  return {
    ok: true,
    value: {
      result: {
        findings: parsed2.value,
        derivedScores: deriveNarrowJudgeScores(parsed2.value, goldClaims, claims),
        judgeMeta: { judgeModelId: judgeModel, judgePromptVersion: NARROW_JUDGE_PROMPT_VERSION },
      },
      traces,
    },
  };
}
