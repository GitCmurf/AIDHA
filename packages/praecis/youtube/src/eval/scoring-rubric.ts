import { z } from "zod";

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
    judgeModelId: z.string().min(1),
    judgePromptVersion: z.string().min(1),
  }),
});

export type ClaimSetScore = z.infer<typeof ClaimSetScoreSchema>;
