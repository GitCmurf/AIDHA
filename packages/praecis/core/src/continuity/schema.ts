// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const ContinuityId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/);
export const ContinuityDate = z.iso.date();
const text = z.string().trim().min(1).max(4000);
export const ContinuitySource = z.object({
  id: ContinuityId,
  text: z.string().min(1).max(32000),
  author: text,
  capturedAt: z.iso.datetime({ offset: true }),
  intent: z.enum(['illustrative', 'operational']),
}).strict();
const activity = z.object({
  id: ContinuityId, label: text,
  date: ContinuityDate.nullable().describe('Activity date, or null when unknown. A prerequisite before a dated event does not inherit that event date.'),
  dateBasis: z.enum(['supplied', 'inferred', 'unknown']).optional()
    .describe('Basis of the activity date, distinct from fact-value provenance.'),
  participants: z.array(text).min(1).max(20),
  prerequisites: z.array(ContinuityId).max(100),
}).strict().superRefine((item, ctx) => {
  if (item.date === null && item.dateBasis !== undefined && item.dateBasis !== 'unknown') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'An undated activity cannot have a supplied or inferred date basis' });
  }
});
export const ContinuityFact = z.object({
  id: ContinuityId, activityId: ContinuityId, key: text,
  value: text.nullable(), basis: z.enum(['supplied', 'inferred']),
  appliesOn: ContinuityDate.nullable().describe('Must match the linked activity date. Null means unknown, not applicable every day.'),
}).strict();
const decision = z.object({
  id: ContinuityId, choice: text, by: text, appliesOn: ContinuityDate,
  activityIds: z.array(ContinuityId).min(1).max(100),
  conditions: z.array(text).max(20), revisitWhen: z.array(text).max(20),
}).strict();
const question = z.object({
  id: ContinuityId, question: text, activityIds: z.array(ContinuityId).max(100),
}).strict();
export const CaptureEvent = z.object({
  kind: z.literal('capture'), eventId: ContinuityId,
  expectedRevision: z.literal(0), source: ContinuitySource,
  title: text, interpreter: text,
  activities: z.array(activity).min(1).max(100),
  facts: z.array(ContinuityFact).max(200).describe(
    'Preserve source-stated responsibilities and ownership as explicit facts. Do not infer them from participation alone.',
  ),
  decisions: z.array(decision).max(100), questions: z.array(question).max(100),
}).strict();
export type CaptureEvent = z.infer<typeof CaptureEvent>;

export const CorrectionEvent = z.object({
  kind: z.literal('correct'), eventId: ContinuityId,
  expectedRevision: z.number().int().min(1), source: ContinuitySource, interpreter: text,
  factId: ContinuityId, value: text.nullable(), basis: z.enum(['supplied', 'inferred']),
}).strict();
export const UpdateEvent = CorrectionEvent;
export const ContinuityEvent = z.discriminatedUnion('kind', [CaptureEvent, CorrectionEvent]);
export type ContinuityEvent = z.infer<typeof ContinuityEvent>;

export const StoredCase = z.object({
  schemaVersion: z.literal(1), caseId: ContinuityId,
  events: z.array(z.object({ event: ContinuityEvent, recordedAt: z.iso.datetime({ offset: true }) }).strict()).min(1).max(200),
}).strict();
export type StoredCase = z.infer<typeof StoredCase>;

export function continuityInputSchema(kind: 'capture' | 'update') {
  return z.toJSONSchema(kind === 'capture' ? CaptureEvent : UpdateEvent);
}
