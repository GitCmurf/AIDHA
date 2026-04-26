import { z } from "zod";

export const GoldenClaimTypeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, {
  message: "Claim type must be a normalized machine string such as 'research_finding'",
});

export const GoldenClaimEvidenceSchema = z.object({
  quote: z.string().optional(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
}).refine(data => data.endMs >= data.startMs, {
  message: "endMs must be greater than or equal to startMs",
  path: ["endMs"],
});

export type GoldenClaimNode = {
  text: string;
  type: string;
  children: GoldenClaimNode[];
  evidence?: {
    quote?: string;
    startMs: number;
    endMs: number;
  };
};

export const GoldenClaimNodeSchema: z.ZodType<GoldenClaimNode> = z.lazy(() => z.object({
  text: z.string().trim().min(1),
  type: GoldenClaimTypeSchema,
  children: z.array(GoldenClaimNodeSchema),
  evidence: GoldenClaimEvidenceSchema.optional(),
}));

export const GoldenRejectedClaimSchema = z.object({
  text: z.string().trim().min(1),
  reason: z.enum(["hallucination", "redundant", "fragment", "topic-drift"]),
});

export const GoldenAnnotationEntrySchema = z.object({
  videoId: z.string().min(1),
  title: z.string().min(1),
  speaker: z.string().min(1).optional(),
  speakerCredentials: z.string().min(1).optional(),
  idealClaims: z.array(GoldenClaimNodeSchema),
  rejectedClaims: z.array(GoldenRejectedClaimSchema),
}).refine(data => !data.speakerCredentials || !!data.speaker, {
  message: "speakerCredentials requires speaker",
  path: ["speakerCredentials"],
});

export const GoldenAnnotationSchema = z.array(GoldenAnnotationEntrySchema);

export type GoldenAnnotation = z.infer<typeof GoldenAnnotationSchema>;
export type GoldenAnnotationEntry = z.infer<typeof GoldenAnnotationEntrySchema>;
export type GoldenClaimNode = z.infer<typeof GoldenClaimNodeSchema>;
