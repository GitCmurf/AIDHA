import { z } from "zod";

export const CorpusEntrySchema = z.object({
  videoId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  channelName: z.string().min(1),
  durationMinutes: z.number().min(0),
  topicDomain: z.string().min(1),
  expectedClaimDensity: z.enum(["low", "medium", "high"]),
  language: z.string().min(1).optional(),
  captionSource: z.enum(["manual", "auto", "unknown"]).optional(),
  speakerStyle: z.enum(["solo", "interview", "panel", "unknown"]).optional(),
  rationale: z.string().min(1),
});

export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

export const CorpusSchema = z.array(CorpusEntrySchema).min(5);
