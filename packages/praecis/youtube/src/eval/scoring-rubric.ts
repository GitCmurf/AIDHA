import { z } from "zod";

/**
 * Tolerance for overallScore validation against the average of four dimensions.
 * The overallScore must be within this tolerance of the average.
 */
export const OVERALL_SCORE_TOLERANCE = 0.5;

/**
 * Canonical list of score dimensions used across the evaluation system.
 * Import this wherever you need to iterate over score dimensions.
 */
export const SCORE_DIMENSIONS = ["completeness", "accuracy", "topicCoverage", "atomicity", "overallScore"] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const ClaimSetScoreSchema = z.object({
  completeness: z.number().min(0).max(10),
  accuracy: z.number().min(0).max(10),
  topicCoverage: z.number().min(0).max(10),
  atomicity: z.number().min(0).max(10),
  overallScore: z.number().min(0).max(10),
  reasoning: z.string().min(10),
  missingClaims: z.array(z.object({ text: z.string().min(1) })),
  hallucinations: z.array(z.object({ text: z.string().min(1) })),
  redundancies: z.array(z.object({ text: z.string().min(1) })),
  gapAreas: z.array(z.object({ area: z.string().min(1) })),
  judgeMeta: z.object({
    judgeModelId: z.string(),
    judgePromptVersion: z.string(),
  }).optional(),
}).superRefine((data, ctx) => {
  const expected = (data.completeness + data.accuracy + data.topicCoverage + data.atomicity) / 4;
  if (Math.abs(data.overallScore - expected) > OVERALL_SCORE_TOLERANCE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["overallScore"],
      message: `overallScore (${data.overallScore}) must be the average of the other four dimensions. Expected ~${expected.toFixed(2)}, got ${data.overallScore}.`,
    });
  }
});

/**
 * Represents the structured score for a set of extracted claims.
 */
export type ClaimSetScore = z.infer<typeof ClaimSetScoreSchema>;
