import { z } from "zod";

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
}).superRefine((data, ctx) => {
  const expected = (data.completeness + data.accuracy + data.topicCoverage + data.atomicity) / 4;
  if (Math.abs(data.overallScore - expected) > 0.6) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["overallScore"],
      message: `overallScore (${data.overallScore}) must approximately equal the average of the four dimensions (${expected.toFixed(2)})`,
    });
  }
});

/**
 * Represents the structured score for a set of extracted claims.
 * Note: judgeMeta is internal process metadata (judge ID and prompt version) that is
 * injected by the scoring harness after parsing the LLM response.
 */
export type ClaimSetScore = z.infer<typeof ClaimSetScoreSchema> & {
  judgeMeta?: {
    judgeModelId: string;
    judgePromptVersion: string;
  };
  traces?: Array<{ prompt: { system: string; user: string }; response: string }>;
};
