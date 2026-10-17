// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import type { GraphStore, Result } from '@aidha/graph-backend';
import type { MiningResult } from '../../interfaces/index.js';
import { KnowledgeUnitSchema, SourceDistillationSchema, UNIT_KINDS, UNIT_STANCES, UNIT_IMPORTANCES,
  UnitAttributionSchema, UnitConditionSchema } from './schema.js';
import { EXTRACTION_INTENTS } from './projection.js';
import { QUOTE_VERIFICATION_STATUSES, verifyQuote } from './quote-verification.js';
import { buildDistillationOutput } from './report.js';

const EvidenceSchema = z.object({
  excerptId: z.string().min(1), quote: z.string().min(1),
  quoteVerification: z.enum(QUOTE_VERIFICATION_STATUSES),
});
const VerifiedUnitSchema = KnowledgeUnitSchema.safeExtend({ evidence: z.array(EvidenceSchema).min(1) });
const AdmittedUnitSchema = KnowledgeUnitSchema.safeExtend({ evidence: z.array(EvidenceSchema.extend({
  quoteVerification: z.enum(['exact', 'normalized']),
})).min(1) });
const RejectedUnitSchema = z.object({
  unit: VerifiedUnitSchema, reason: z.enum(['ungrounded', 'failed_quote_verification']),
});
const SupportingUnitSchema = z.object({
  id: z.string().min(1), kind: z.enum(UNIT_KINDS), text: z.string().min(1),
  supportsUnitIds: z.array(z.string().min(1)),
  unresolvedSupportsUnitIds: z.array(z.string().min(1)).optional(),
  excerptIds: z.array(z.string().min(1)), evidence: z.array(EvidenceSchema.extend({
    quoteVerification: z.enum(['exact', 'normalized']),
  })).optional(),
  stance: z.enum(UNIT_STANCES).optional(), importance: z.enum(UNIT_IMPORTANCES).optional(),
  rationale: z.string().min(1).optional(), conditions: z.array(UnitConditionSchema).optional(),
  attribution: UnitAttributionSchema.optional(),
});
const CoverageSchema = z.object({
  citedExcerptCount: z.number().int().nonnegative(), excerptsCitedPercent: z.number().finite(),
  citedTextPercent: z.number().finite(), largestUncitedGapSeconds: z.number().finite(),
  coreUnitsWithoutVerifiedEvidence: z.number().int().nonnegative(), weakQuoteCount: z.number().int().nonnegative(),
});
const ReportSchema = z.object({
  sourceType: z.string().min(1), sourcePurpose: z.string().min(1).optional(),
  sourceCoherence: z.string().min(1), theses: z.array(z.string()), coverage: CoverageSchema,
  unitCountsByKind: z.record(z.string(), z.number().int().nonnegative()), diagnostics: z.array(z.string()),
}).passthrough();

export const ExtractionSnapshotCandidateSchema = z.object({
  schemaVersion: z.literal(1), trusted: z.literal(false), sourceCanonicalId: z.string().min(1),
  extractionIntent: z.enum(EXTRACTION_INTENTS), minerIdentity: z.string().min(1),
  model: z.string().min(1), promptVersion: z.string().min(1),
  preProjectionDiagnostics: z.array(z.string()),
  proposal: SourceDistillationSchema.safeExtend({ schemaVersion: z.literal(1) }), finalUnits: z.array(AdmittedUnitSchema),
  rejectedUnits: z.array(RejectedUnitSchema), supportingUnits: z.array(SupportingUnitSchema),
  report: ReportSchema,
});
export const ExtractionSnapshotSchema = ExtractionSnapshotCandidateSchema.extend({
  resourceId: z.string().min(1), claimIds: z.array(z.string().min(1)),
  excerptIds: z.array(z.string().min(1)), candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export type ExtractionSnapshotCandidate = z.infer<typeof ExtractionSnapshotCandidateSchema>;
export type ExtractionSnapshot = z.infer<typeof ExtractionSnapshotSchema>;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

export const hashSnapshotCandidate = (candidate: ExtractionSnapshotCandidate): string =>
  createHash('sha256').update(JSON.stringify(canonicalJson(candidate))).digest('hex');

function isJsonValue(value: unknown, active = new WeakSet<object>(), inArray = false): boolean {
  if (value === undefined) return !inArray; // Object optionals are intentionally absent on the wire.
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (active.has(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value) || !isJsonValue(value[index], active, true)) return false;
      }
      return true;
    }
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) return false;
    return Object.values(value).every(item => isJsonValue(item, active));
  } finally {
    active.delete(value);
  }
}

function sameJsonWire(left: unknown, right: unknown): boolean {
  try {
    if (!isJsonValue(left) || !isJsonValue(right)) return false;
    const leftWire = JSON.stringify(left);
    const rightWire = JSON.stringify(right);
    return leftWire !== undefined && rightWire !== undefined &&
      isDeepStrictEqual(JSON.parse(leftWire), JSON.parse(rightWire));
  } catch {
    return false;
  }
}

/** Normalize to the durable JSON representation before caching, reporting or writing. */
export function parseSnapshotCandidate(value: unknown): ExtractionSnapshotCandidate | null {
  try {
    if (!isJsonValue(value)) return null;
    const wire: unknown = JSON.parse(JSON.stringify(value));
    const parsed = ExtractionSnapshotCandidateSchema.safeParse(wire);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseExtractionSnapshot(value: unknown): ExtractionSnapshot | null {
  try {
    if (!isJsonValue(value)) return null;
    const wire: unknown = JSON.parse(JSON.stringify(value));
    const parsed = ExtractionSnapshotSchema.safeParse(wire);
    if (!parsed.success) return null;
    const candidate = ExtractionSnapshotCandidateSchema.parse(parsed.data);
    return parsed.data.candidateHash === hashSnapshotCandidate(candidate) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A cache record cannot be promoted for another source, miner or excerpt set. */
export function snapshotMatchesInput(candidate: ExtractionSnapshotCandidate, sourceCanonicalId: string,
  minerIdentity: string, excerpts: ReadonlyMap<string, string>): boolean {
  if (candidate.sourceCanonicalId !== sourceCanonicalId || candidate.minerIdentity !== minerIdentity) return false;
  const known = (id: string) => excerpts.has(id);
  const matchesQuote = (ref: { excerptId: string; quote: string; quoteVerification: string }) =>
    verifyQuote(ref.quote, excerpts.get(ref.excerptId) ?? '') === ref.quoteVerification;
  return candidate.proposal.units.every(unit => unit.evidence.every(ref => known(ref.excerptId))) &&
    candidate.finalUnits.every(unit => unit.evidence.every(ref => known(ref.excerptId) && matchesQuote(ref))) &&
    candidate.rejectedUnits.every(item => item.unit.evidence.every(ref => known(ref.excerptId) && matchesQuote(ref))) &&
    candidate.supportingUnits.every(unit => unit.excerptIds.every(known) &&
      (unit.evidence ?? []).every(ref => known(ref.excerptId) && matchesQuote(ref)));
}

/** Re-run the deterministic projection so a valid-shaped cache cannot contradict its own claims. */
export function snapshotMatchesMiningResult(candidate: ExtractionSnapshotCandidate, result: MiningResult): boolean {
  if (result.extractionSnapshotCandidateHash !== hashSnapshotCandidate(candidate)) return false;
  const proposedIds = candidate.proposal.units.map(unit => unit.id);
  const routedIds = [...candidate.finalUnits.map(unit => unit.id), ...candidate.rejectedUnits.map(item => item.unit.id)];
  if (new Set(proposedIds).size !== proposedIds.length || !isDeepStrictEqual([...proposedIds].sort(), [...routedIds].sort())) return false;
  const output = buildDistillationOutput({
    extractionIntent: candidate.extractionIntent, sourceType: candidate.proposal.sourceType,
    sourcePurpose: candidate.proposal.sourcePurpose, sourceCoherence: candidate.proposal.sourceCoherence,
    theses: candidate.proposal.theses, units: candidate.finalUnits, rejectedUnits: candidate.rejectedUnits,
    coverage: candidate.report.coverage, diagnostics: candidate.preProjectionDiagnostics,
    model: candidate.model, promptVersion: candidate.promptVersion,
  });
  return sameJsonWire(output.claims, result.claims) &&
    sameJsonWire(output.rejectedClaims, result.rejectedClaims ?? []) &&
    sameJsonWire(output.supportingUnits, candidate.supportingUnits) &&
    sameJsonWire(output.supportingUnits, result.supportingUnits ?? []) &&
    sameJsonWire(output.distillation, candidate.report) &&
    sameJsonWire({ ...output.distillation, failedClosed: false }, result.distillation);
}

/** Absent checkpoints are distinct from malformed or unsupported stored versions. */
export async function readExtractionSnapshot(store: GraphStore, resourceId: string): Promise<Result<ExtractionSnapshot | null>> {
  const found = await store.getNode(resourceId);
  if (!found.ok) return found;
  if (!found.value) return { ok: true, value: null };
  if (found.value.type !== 'Resource') return { ok: false, error: new Error(`${resourceId} is not a Resource`) };
  const raw = found.value.metadata?.['extractionSnapshot'];
  if (raw === undefined) return { ok: true, value: null };
  const snapshot = parseExtractionSnapshot(raw);
  if (!snapshot || snapshot.resourceId !== resourceId) {
    return { ok: false, error: new Error(`Invalid or unsupported extraction snapshot for ${resourceId}`) };
  }
  return { ok: true, value: snapshot };
}
