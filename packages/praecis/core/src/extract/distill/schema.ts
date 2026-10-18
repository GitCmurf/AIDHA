// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { z } from 'zod';
import { capErrors, extractJsonObject } from './json.js';

export const DISTILLATION_SCHEMA_VERSION = 1;

export const SOURCE_TYPES = ['explainer', 'tutorial', 'interview', 'talk', 'demo', 'compilation', 'other'] as const;
export const SOURCE_COHERENCES = ['single_topic', 'multi_topic', 'mixed', 'unclear'] as const;
export const UNIT_KINDS = ['idea', 'mechanism', 'fact', 'recommendation', 'limitation', 'example', 'procedure'] as const;
export const UNIT_IMPORTANCES = ['core', 'supporting', 'incidental'] as const;
export const UNIT_STANCES = ['asserted', 'recommended', 'demonstrated', 'reported', 'speculative', 'contested'] as const;
export const CONDITION_TYPES = ['temporal', 'scale', 'audience', 'assumption', 'exclusion'] as const;
export const GENERATION_ATTRIBUTION_KINDS = ['speaker', 'third_party', 'study', 'tool_output', 'unknown'] as const;
// Preserve the meaning of older saved records; do not silently reclassify their origins.
export const ATTRIBUTION_KINDS = [...GENERATION_ATTRIBUTION_KINDS, 'named_third_party'] as const;

export type SourceType = typeof SOURCE_TYPES[number];
export type SourceCoherence = typeof SOURCE_COHERENCES[number];
export type UnitKind = typeof UNIT_KINDS[number];
export type UnitImportance = typeof UNIT_IMPORTANCES[number];
export type UnitStance = typeof UNIT_STANCES[number];
export type ConditionType = typeof CONDITION_TYPES[number];
export type AttributionKind = typeof ATTRIBUTION_KINDS[number];

// Structured-output providers encode optional fields as required nullable values.
const optionalField = <T extends z.ZodType>(schema: T) => {
  return z.preprocess(value => value === null ? undefined : value, schema.optional());
};

export const UnitConditionSchema = z.object({
  type: z.enum(CONDITION_TYPES),
  text: z.string().min(1),
});

export const UnitAttributionSchema = z.object({
  kind: z.enum(ATTRIBUTION_KINDS),
  name: optionalField(z.string().min(1)),
  role: optionalField(z.string().trim().min(1)),
}).superRefine((attribution, ctx) => {
  if (attribution.kind === 'unknown' && (attribution.name !== undefined || attribution.role !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unknown attribution cannot assert a name or role' });
  }
});

const UnitAttributionResponseSchema = z.object({
  kind: z.enum(GENERATION_ATTRIBUTION_KINDS),
  name: z.string().min(1).nullable(),
  role: z.string().min(1).nullable(),
});

const UnitEvidenceSchema = z.object({
  excerptId: z.string().min(1),
  quote: z.string().min(1),
});

export const KnowledgeUnitSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(UNIT_KINDS),
  text: z.string().min(20),
  // Empty optional fields are absent information, not a reason to discard other units.
  // A source can recommend an action without explaining why; do not force invented reasons.
  rationale: z.preprocess(value => value === null || (typeof value === 'string' && !value.trim()) ? undefined : value,
    z.string().trim().min(1).optional()),
  conditions: optionalField(z.array(UnitConditionSchema)),
  attribution: optionalField(UnitAttributionSchema),
  stance: z.enum(UNIT_STANCES).default('asserted'),
  evidence: z.array(UnitEvidenceSchema).min(1),
  supportsUnitIds: optionalField(z.array(z.string().min(1))),
  importance: z.enum(UNIT_IMPORTANCES),
}).superRefine((unit, ctx) => {
  if (unit.kind === 'limitation' && !unit.rationale && (unit.conditions?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unit ${unit.id}: limitation requires rationale or conditions` });
  }
});

export const SourceDistillationSchema = z.object({
  schemaVersion: z.number().int().positive(),
  sourceType: z.enum(SOURCE_TYPES),
  sourcePurpose: optionalField(z.string().min(1)),
  sourceCoherence: z.enum(SOURCE_COHERENCES),
  theses: z.array(z.string().min(1)),
  units: z.array(KnowledgeUnitSchema),
});

export type KnowledgeUnit = z.infer<typeof KnowledgeUnitSchema>;
export type SourceDistillation = z.infer<typeof SourceDistillationSchema>;

/** Constrain ID selection at generation time; host validation remains authoritative. */
export const distillationResponseSchema = (excerptIds: ReadonlySet<string>): Record<string, unknown> => {
  if (excerptIds.size === 0) {
    throw new RangeError('A generation schema requires at least one excerpt.');
  }
  const evidence = UnitEvidenceSchema.extend({ excerptId: z.enum([...excerptIds]) });
  // Keep host refinements in parseSourceDistillation. The wire schema must require
  // every property, with null representing absent optional information.
  const unit = z.object({
    ...KnowledgeUnitSchema.shape,
    rationale: z.string().min(1).nullable(),
    conditions: z.array(UnitConditionSchema).nullable(),
    attribution: UnitAttributionResponseSchema.nullable(),
    stance: z.enum(UNIT_STANCES),
    supportsUnitIds: z.array(z.string().min(1)).nullable(),
    evidence: z.array(evidence).min(1),
  });
  return z.toJSONSchema(SourceDistillationSchema.extend({
    schemaVersion: z.literal(DISTILLATION_SCHEMA_VERSION),
    sourcePurpose: z.string().min(1).nullable(), units: z.array(unit),
  }), { io: 'output' });
};

export type ParseDistillationResult =
  | { readonly ok: true; readonly value: SourceDistillation }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Parses and validates an LLM distillation response.
 * Errors are phrased so they can be fed back verbatim in a repair re-prompt.
 */
export const parseSourceDistillation = (raw: string, knownExcerptIds: ReadonlySet<string>): ParseDistillationResult => {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, errors: ['Response contains no JSON object.'] };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, errors: [`Response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const parsed = SourceDistillationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const zodErrors = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return {
      ok: false,
      errors: capErrors(zodErrors),
    };
  }

  if (parsed.data.schemaVersion !== DISTILLATION_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`schemaVersion must be ${DISTILLATION_SCHEMA_VERSION}.`],
    };
  }

  const errors: string[] = [];
  const unitIds = new Set<string>();
  for (const unit of parsed.data.units) {
    if (unitIds.has(unit.id)) errors.push(`Duplicate unit id "${unit.id}".`);
    unitIds.add(unit.id);
  }
  for (const unit of parsed.data.units) {
    for (const supported of unit.supportsUnitIds ?? []) {
      if (!unitIds.has(supported)) {
        errors.push(`unit ${unit.id}: supportsUnitIds references unknown unit id "${supported}".`);
      }
    }
    for (const evidence of unit.evidence) {
      if (!knownExcerptIds.has(evidence.excerptId)) {
        errors.push(`unit ${unit.id}: evidence cites unknown excerpt id "${evidence.excerptId}".`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors: capErrors(errors) };
  return { ok: true, value: parsed.data };
};
