import type { ClaimCandidate, LlmClient } from "../extract/index.js";
import type { FlattenedGoldenClaimNode } from "./golden-annotation-utils.js";
import type { VideoContext } from "./matrix-runner.js";
import {
  scoreNarrowClaimSet,
  type NarrowDerivedJudgeScores,
  type NarrowJudgeFindings,
} from "./narrow-judge.js";
import type {
  ComparableClaimSet,
  NarrowComparisonCandidateReport,
} from "./narrow-report-types.js";
import type { Logger } from "../utils/logger.js";

export interface NarrowJudgeTranscriptContext {
  videoContext: VideoContext;
  fullText: string;
}

function classifyNarrowJudgeError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return "rate-limit";
  }
  if (normalized.includes("503") || normalized.includes("unavailable") || normalized.includes("high demand")) {
    return "provider-unavailable";
  }
  if (normalized.includes("timeout") || normalized.includes("aborted")) {
    return "timeout";
  }
  if (normalized.includes("parse") || normalized.includes("json") || normalized.includes("schema")) {
    return "parse-or-schema";
  }
  if (normalized.includes("401") || normalized.includes("api key") || normalized.includes("authorization")) {
    return "auth";
  }
  return "error";
}

export async function enrichCandidateReportWithJudges(
  report: NarrowComparisonCandidateReport,
  candidate: ComparableClaimSet,
  transcript: NarrowJudgeTranscriptContext,
  goldClaims: FlattenedGoldenClaimNode[],
  teacherClaims: ClaimCandidate[],
  judgeClients: Map<string, LlmClient>,
  judgeModelIds: string[],
  judgeMaxTokens: number,
  logger: Logger
): Promise<void> {
  if (candidate.claims.length === 0 || candidate.error) {
    return;
  }

  const judgeFindingsByModel: Record<string, NarrowJudgeFindings> = {};
  const derivedScoresByModel: Record<string, NarrowDerivedJudgeScores> = {};
  const judgeErrors: string[] = [];

  for (const judgeModelId of judgeModelIds) {
    const judgeClient = judgeClients.get(judgeModelId);
    if (!judgeClient) {
      judgeErrors.push(`${judgeModelId}: No client configured for this judge model`);
      continue;
    }
    logger.info(
      `[judge ${judgeModelId}] candidate=${candidate.candidateId} video=${candidate.videoId} claims=${candidate.claims.length}`
    );
    const scoreResult = await scoreNarrowClaimSet(
      judgeClient,
      judgeModelId,
      transcript.fullText,
      candidate.claims,
      goldClaims,
      teacherClaims,
      transcript.videoContext,
      judgeMaxTokens
    );
    if (!scoreResult.ok) {
      const errorClass = classifyNarrowJudgeError(scoreResult.error.message);
      logger.warn(
        `[judge-failed ${judgeModelId}] candidate=${candidate.candidateId} video=${candidate.videoId} class=${errorClass}: ${scoreResult.error.message}`
      );
      judgeErrors.push(`${judgeModelId}: ${scoreResult.error.message}`);
      continue;
    }
    judgeFindingsByModel[judgeModelId] = scoreResult.value.result.findings;
    derivedScoresByModel[judgeModelId] = scoreResult.value.result.derivedScores;
    logger.info(
      `[judge-done ${judgeModelId}] candidate=${candidate.candidateId} video=${candidate.videoId} overall=${scoreResult.value.result.derivedScores.overallScore.toFixed(2)} gold=${scoreResult.value.result.derivedScores.goldCoverage.toFixed(2)}`
    );
  }

  const overallValues = Object.values(derivedScoresByModel).map((score) => score.overallScore);
  const goldValues = Object.values(derivedScoresByModel).map((score) => score.goldCoverage);
  const judgeDisagreement = overallValues.length > 1
    ? {
        models: Object.keys(derivedScoresByModel),
        overallSpread: Number((Math.max(...overallValues) - Math.min(...overallValues)).toFixed(2)),
        goldCoverageSpread: Number((Math.max(...goldValues) - Math.min(...goldValues)).toFixed(2)),
      }
    : undefined;

  report.judgeFindingsByModel = Object.keys(judgeFindingsByModel).length > 0 ? judgeFindingsByModel : undefined;
  report.derivedScoresByModel = Object.keys(derivedScoresByModel).length > 0 ? derivedScoresByModel : undefined;
  report.judgeDisagreement = judgeDisagreement && (judgeDisagreement.overallSpread >= 1 || judgeDisagreement.goldCoverageSpread >= 1)
    ? judgeDisagreement
    : undefined;
  const allJudgesFailed = judgeErrors.length > 0 && Object.keys(derivedScoresByModel).length === 0;
  const someJudgesFailed = judgeErrors.length > 0 && Object.keys(derivedScoresByModel).length > 0;
  const isLowerRankedSkip = !report.derivedScoresByModel && !allJudgesFailed;

  report.note = [
    report.note,
    someJudgesFailed ? `Some judges failed: ${judgeErrors.join(" ; ")}` : undefined,
    allJudgesFailed ? `All judges failed: ${judgeErrors.join(" ; ")}` : undefined,
    isLowerRankedSkip ? "No judge client available for configured judge models" : undefined,
  ].filter(Boolean).join(" - ") || undefined;
  if (allJudgesFailed) {
    report.error = judgeErrors.join(" ; ");
  }
}
