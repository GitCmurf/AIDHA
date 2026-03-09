import { z } from "zod";

export const GoldenAnnotationSchema = z.array(z.object({
  videoId: z.string().min(1),
  idealClaims: z.array(z.object({
    text: z.string().min(1),
    evidence: z.object({
      quote: z.string().optional(),
      startMs: z.number().nonnegative(),
      endMs: z.number().nonnegative(),
    }).optional(),
  })),
  rejectedClaims: z.array(z.object({
    text: z.string().min(1),
    reason: z.enum(["hallucination", "redundant", "fragment", "topic-drift"]),
  })),
}));

export type GoldenAnnotation = z.infer<typeof GoldenAnnotationSchema>;
