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
export const ATTRIBUTION_KINDS = ['speaker', 'named_third_party', 'study', 'tool_output'] as const;

export type SourceType = typeof SOURCE_TYPES[number];
export type SourceCoherence = typeof SOURCE_COHERENCES[number];
export type UnitKind = typeof UNIT_KINDS[number];
export type UnitImportance = typeof UNIT_IMPORTANCES[number];
export type UnitStance = typeof UNIT_STANCES[number];
export type ConditionType = typeof CONDITION_TYPES[number];
export type AttributionKind = typeof ATTRIBUTION_KINDS[number];

const UnitConditionSchema = z.object({
  type: z.enum(CONDITION_TYPES),
  text: z.string().min(1),
});

const UnitAttributionSchema = z.object({
  kind: z.enum(ATTRIBUTION_KINDS),
  name: z.string().min(1).optional(),
});

const UnitEvidenceSchema = z.object({
  excerptId: z.string().min(1),
  quote: z.string().min(1),
});

export const KnowledgeUnitSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(UNIT_KINDS),
  text: z.string().min(20),
  rationale: z.string().min(1).optional(),
  conditions: z.array(UnitConditionSchema).optional(),
  attribution: UnitAttributionSchema.optional(),
  stance: z.enum(UNIT_STANCES).default('asserted'),
  evidence: z.array(UnitEvidenceSchema).min(1),
  supportsUnitIds: z.array(z.string().min(1)).optional(),
  importance: z.enum(UNIT_IMPORTANCES),
}).superRefine((unit, ctx) => {
  if (unit.kind === 'recommendation' && !unit.rationale) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unit ${unit.id}: recommendation requires rationale` });
  }
  if (unit.kind === 'limitation' && !unit.rationale && (unit.conditions?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unit ${unit.id}: limitation requires rationale or conditions` });
  }
});

export const SourceDistillationSchema = z.object({
  schemaVersion: z.number().int().positive(),
  sourceType: z.enum(SOURCE_TYPES),
  sourcePurpose: z.string().min(1).optional(),
  sourceCoherence: z.enum(SOURCE_COHERENCES),
  theses: z.array(z.string().min(1)),
  units: z.array(KnowledgeUnitSchema),
});

export type KnowledgeUnit = z.infer<typeof KnowledgeUnitSchema>;
export type SourceDistillation = z.infer<typeof SourceDistillationSchema>;

export type ParseDistillationResult =
  | { readonly ok: true; readonly value: SourceDistillation }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Parses and validates an LLM distillation response.
 * Errors are phrased so they can be fed back verbatim in a repair re-prompt.
 */
export function parseSourceDistillation(
  raw: string,
  knownExcerptIds: ReadonlySet<string>
): ParseDistillationResult {
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
}
