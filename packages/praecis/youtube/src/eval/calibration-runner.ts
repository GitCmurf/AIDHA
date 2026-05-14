import { SCORE_DIMENSIONS, type ScoreDimension } from "./scoring-rubric.js";
import { scoreClaimSet } from "./scoring-executor.js";
import type { GoldenAnnotationEntry, GoldenClaimNode } from "./golden-annotation-schema.js";
import type { LlmClient } from "../extract/llm-client.js";
import type { ClaimCandidate } from "../extract/types.js";
import type { CalibrationRecord, CalibrationVideoResult } from "./calibration-schema.js";

export interface CalibrationRunOptions {
  goldenEntries: GoldenAnnotationEntry[];
  transcripts: Record<string, string>;
  judgeClient: LlmClient;
  judgeModelId: string;
  promptVersion: string;
  agreementThreshold: number;
  signal?: AbortSignal;
}

export const CALIBRATION_JUDGE_MAX_TOKENS = 4000;

const CALIBRATION_CHANNEL_PLACEHOLDER = "" as const;

const PERFECT_HUMAN_SCORE: Record<ScoreDimension, number> = Object.fromEntries(
  SCORE_DIMENSIONS.map(d => [d, 10])
) as Record<ScoreDimension, number>;

function flattenIdealClaims(nodes: GoldenClaimNode[]): ClaimCandidate[] {
  const result: ClaimCandidate[] = [];
  const queue = [...nodes];
  let i = 0;
  while (i < queue.length) {
    const node = queue[i++]!;
    result.push({ text: node.text, excerptIds: [] });
    if (node.children.length > 0) queue.push(...node.children);
  }
  return result;
}

/** Agreement metric: 1 − |delta| / 10, clamped to [0, 1]. */
function agreement(human: number, judge: number): number {
  return Math.max(0, 1 - Math.abs(human - judge) / 10);
}

const buildAgreementRecord = (
  human: Record<ScoreDimension, number>,
  judge: Record<ScoreDimension, number>
): Record<ScoreDimension, number> =>
  Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, agreement(human[d], judge[d])])) as Record<ScoreDimension, number>;

const buildDeltaRecord = (
  human: Record<ScoreDimension, number>,
  judge: Record<ScoreDimension, number>
): Record<ScoreDimension, number> =>
  Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, judge[d] - human[d]])) as Record<ScoreDimension, number>;

const avgAgreements = (results: CalibrationVideoResult[]): Record<ScoreDimension, number> => {
  if (results.length === 0) return Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, 0])) as Record<ScoreDimension, number>;
  return Object.fromEntries(
    SCORE_DIMENSIONS.map(d => [d, results.reduce((s, r) => s + r.agreements[d], 0) / results.length])
  ) as Record<ScoreDimension, number>;
};

export async function runCalibration(opts: CalibrationRunOptions): Promise<CalibrationRecord> {
  const { goldenEntries, transcripts, judgeClient, judgeModelId, promptVersion, agreementThreshold, signal } = opts;
  const skipped: string[] = [];
  const scoringErrors: string[] = [];

  const settled = await Promise.all(
    goldenEntries.map(async entry => {
      const transcript = transcripts[entry.videoId];
      if (!transcript) {
        skipped.push(entry.videoId);
        return null;
      }

      const claims = flattenIdealClaims(entry.idealClaims);
      const videoContext = { videoId: entry.videoId, title: entry.title, channelName: CALIBRATION_CHANNEL_PLACEHOLDER };

      const scoreResult = await scoreClaimSet(judgeClient, judgeModelId, transcript, claims, videoContext, CALIBRATION_JUDGE_MAX_TOKENS, signal);
      if (!scoreResult.ok) {
        scoringErrors.push(entry.videoId);
        return null;
      }

      const judgeScore = Object.fromEntries(
        SCORE_DIMENSIONS.map(d => [d, scoreResult.value.score[d]])
      ) as Record<ScoreDimension, number>;

      const deltas = buildDeltaRecord(PERFECT_HUMAN_SCORE, judgeScore);
      const agreements = buildAgreementRecord(PERFECT_HUMAN_SCORE, judgeScore);
      const passed = SCORE_DIMENSIONS.every(d => agreements[d] >= agreementThreshold);

      return { videoId: entry.videoId, humanScore: PERFECT_HUMAN_SCORE, judgeScore, deltas, agreements, passed } satisfies CalibrationVideoResult;
    })
  );

  const perVideoResults = settled.filter((r): r is CalibrationVideoResult => r !== null);
  const aggregateAgreement = avgAgreements(perVideoResults);
  const overallPassed =
    perVideoResults.length > 0 && SCORE_DIMENSIONS.every(d => aggregateAgreement[d] >= agreementThreshold);

  const notes =
    skipped.length > 0 ? `Skipped (no transcript): ${skipped.join(", ")}` : undefined;

  return {
    promptVersion,
    judgeModelId,
    runDate: new Date().toISOString().slice(0, 10),
    agreementThreshold,
    goldSetVideoIds: goldenEntries.map(e => e.videoId),
    perVideoResults,
    aggregateAgreement,
    overallPassed,
    scoringErrors,
    notes,
  };
}
