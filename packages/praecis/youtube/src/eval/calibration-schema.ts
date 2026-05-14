import { z } from "zod";
import { SCORE_DIMENSIONS } from "./scoring-rubric.js";
import type { ScoreDimension } from "./scoring-rubric.js";

type ZodRecordOf<K extends string, V extends z.ZodTypeAny> = z.ZodObject<Record<K, V>>;

const dimensionRecord = <V extends z.ZodTypeAny>(valueSchema: V): ZodRecordOf<ScoreDimension, V> =>
  z.object(
    Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, valueSchema]))
  ) as ZodRecordOf<ScoreDimension, V>;

export const CalibrationVideoResultSchema = z.object({
  videoId: z.string().min(1),
  humanScore: dimensionRecord(z.number().min(0).max(10)),
  judgeScore: dimensionRecord(z.number().min(0).max(10)),
  deltas: dimensionRecord(z.number()),
  agreements: dimensionRecord(z.number().min(0).max(1)),
  passed: z.boolean(),
});

export const CalibrationRecordSchema = z.object({
  promptVersion: z.string().min(1),
  judgeModelId: z.string().min(1),
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  agreementThreshold: z.number().min(0).max(1),
  goldSetVideoIds: z.array(z.string().min(1)).min(1),
  perVideoResults: z.array(CalibrationVideoResultSchema).min(1),
  aggregateAgreement: dimensionRecord(z.number().min(0).max(1)),
  overallPassed: z.boolean(),
  notes: z.string().optional(),
});

export type CalibrationRecord = z.infer<typeof CalibrationRecordSchema>;
export type CalibrationVideoResult = z.infer<typeof CalibrationVideoResultSchema>;
