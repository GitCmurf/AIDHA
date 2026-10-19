// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type {
  IngestInput,
  RunReport,
  PipelineServices,
  ExtractionContext,
  MiningResult,
  SourceDistillationSummary,
} from '../interfaces/index.js';
import type { ComposedVector } from '../compose/vector.js';
import type { Result } from '@aidha/taxonomy';
import type { DecodeWarning } from '../types/index.js';
import type { ResolvedConfig } from '@aidha/config';
import { createHash } from 'node:crypto';
import { parseSnapshotCandidate, snapshotMatchesInput, snapshotMatchesMiningResult } from '../extract/distill/snapshot.js';

export class SourceDistillationClosedError extends Error {
  constructor(
    readonly sourceCanonicalId: string,
    readonly diagnostics: readonly string[],
    readonly tokenUsage: number,
    readonly summary: SourceDistillationSummary,
  ) {
    super(`Source distillation failed closed for ${sourceCanonicalId}: ${diagnostics.at(-1) ?? 'unknown reason'}`);
    this.name = 'SourceDistillationClosedError';
  }
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function policyRoute(services: PipelineServices, sensitivity: ComposedVector['sensitivity']): RunReport['policyRoute'] {
  return services.privacy.routes?.[sensitivity] ?? services.privacy.defaultRoute;
}

function assertPolicyAllows(services: PipelineServices, sensitivity: ComposedVector['sensitivity']): Result<RunReport['policyRoute']> {
  const route = policyRoute(services, sensitivity);
  if (route === 'disabled') {
    return { ok: false, error: new Error(`privacy policy disables ${sensitivity} extraction`) };
  }
  if (route === 'cloud' && sensitivity === 'confidential') {
    return { ok: false, error: new Error('privacy policy forbids cloud extraction for confidential resources') };
  }
  return { ok: true, value: route };
}

function assertWithinCost(services: PipelineServices, tokenUsage: number, spendUsd: number): Result<void> {
  if (services.costCeiling.maxTokens !== undefined && tokenUsage > services.costCeiling.maxTokens) {
    return { ok: false, error: new Error(`cost ceiling exceeded: ${tokenUsage} tokens > ${services.costCeiling.maxTokens}`) };
  }
  if (services.costCeiling.maxSpendUsd !== undefined && spendUsd > services.costCeiling.maxSpendUsd) {
    return { ok: false, error: new Error(`cost ceiling exceeded: $${spendUsd.toFixed(6)} > $${services.costCeiling.maxSpendUsd.toFixed(6)}`) };
  }
  return { ok: true, value: undefined };
}

function parseMiningResult(value: string, requireSnapshot: boolean, sourceCanonicalId: string,
  minerIdentity: string, excerpts: ReadonlyMap<string, string>): MiningResult | null {
  try {
    const parsed = JSON.parse(value) as MiningResult;
    if (!Array.isArray(parsed.claims) || parsed.distillation?.failedClosed) return null;
    if (!requireSnapshot && parsed.extractionSnapshotCandidate === undefined &&
      parsed.extractionSnapshotCandidateHash === undefined) return parsed;
    const candidate = parseSnapshotCandidate(parsed.extractionSnapshotCandidate);
    return candidate && snapshotMatchesInput(candidate, sourceCanonicalId, minerIdentity, excerpts) &&
      snapshotMatchesMiningResult(candidate, parsed)
      ? { ...parsed, extractionSnapshotCandidate: candidate } : null;
  } catch {
    return null;
  }
}

const NO_REFERENCES = {
  referencesCreated: 0,
  referencesUpdated: 0,
  referencesNoop: 0,
  referenceEdgesCreated: 0,
  referenceEdgesUpdated: 0,
  referenceEdgesNoop: 0,
} as const;

export async function runVector(
  vector: ComposedVector,
  input: IngestInput,
  services: PipelineServices,
): Promise<Result<RunReport>> {
  const startMs = services.clock.now().getTime();

  const registrationPolicy = assertPolicyAllows(services, vector.sensitivity);
  if (!registrationPolicy.ok) return registrationPolicy;

  const ingestResult = await vector.ingestAndDecode(input, {
    config: services.config,
    clock: services.clock,
  });
  if (!ingestResult.ok) return ingestResult;

  const { raw, segments, warnings } = ingestResult.value;

  const runtimePolicy = assertPolicyAllows(services, raw.sensitivity);
  if (!runtimePolicy.ok) return runtimePolicy;

  const context: ExtractionContext = await vector.context.build(raw, services.config as ResolvedConfig);

  const chunkResult = await vector.chunking.chunk({ segments, context });
  if (!chunkResult.ok) return chunkResult;

  const warningMessages = warnings.map((w: DecodeWarning) => `${w.unit}: ${w.reason}`);
  const minerIdentity = services.miner.cacheIdentity;
  const requireSnapshot = services.miner.extractionSnapshotVersion === 1;
  const cacheEnabled = Boolean(minerIdentity?.trim());
  const cacheKey = `pipeline:${raw.canonicalId}:${stableHash({
    chunks: chunkResult.value.map(chunk => [chunk.id, chunk.text, chunk.locator]),
    sourceLabel: raw.label,
    context,
    miner: minerIdentity,
    route: runtimePolicy.value,
    model: services.config.llm.model,
    endpoint: services.config.llm.baseUrl,
    reasoningEffort: services.config.llm.reasoningEffort,
    verbosity: services.config.llm.verbosity,
    extraction: services.config.extraction,
    editor: services.config.editor,
  })}`;
  let cacheHits = 0;
  let cacheWrites = 0;

  let miningResult: MiningResult | null = null;
  const cached = cacheEnabled ? await services.cache.get(cacheKey) : { ok: true as const, value: null };
  if (!cached.ok) return cached;
  if (cached.value) {
    miningResult = parseMiningResult(cached.value, requireSnapshot, raw.canonicalId,
      minerIdentity ?? '', new Map(chunkResult.value.map(chunk => [chunk.id, chunk.text])));
    if (miningResult) {
      cacheHits += 1;
    }
  }

  if (!miningResult) {
    const miningRequest = {
      raw,
      chunks: chunkResult.value,
      context,
      config: services.config,
      policyRoute: runtimePolicy.value,
      llm: services.llm,
      costCeiling: services.costCeiling,
      clock: services.clock,
    };
    const estimate = services.miner.estimate?.(miningRequest);
    if (estimate && !estimate.ok) return estimate;
    if (estimate?.ok) {
      const estimatedCostCheck = assertWithinCost(services, estimate.value.tokenUsage, estimate.value.spendUsd);
      if (!estimatedCostCheck.ok) return estimatedCostCheck;
    }
    const mined = await services.miner.mine(miningRequest);
    if (!mined.ok) return mined;
    miningResult = mined.value;
  }

  const tokenUsage = miningResult.tokenUsage ?? 0;
  const spendUsd = miningResult.spendUsd ?? 0;
  if (miningResult.distillation?.failedClosed) {
    return { ok: false, error: new SourceDistillationClosedError(raw.canonicalId,
      miningResult.distillation.diagnostics, tokenUsage, miningResult.distillation) };
  }
  const costCheck = assertWithinCost(services, tokenUsage, spendUsd);
  if (!costCheck.ok) return costCheck;
  if (requireSnapshot) {
    const candidate = parseSnapshotCandidate(miningResult.extractionSnapshotCandidate);
    // An absent cache identity disables reuse, not fresh snapshot admission.
    const snapshotIdentity = cacheEnabled ? minerIdentity ?? '' : candidate?.minerIdentity ?? '';
    if (!candidate || !snapshotMatchesInput(candidate, raw.canonicalId, snapshotIdentity,
      new Map(chunkResult.value.map(chunk => [chunk.id, chunk.text]))) ||
      !snapshotMatchesMiningResult(candidate, miningResult)) {
      return { ok: false, error: new Error('Source distillation produced no complete matching extraction snapshot') };
    }
    miningResult = { ...miningResult, extractionSnapshotCandidate: candidate };
  }

  const exported = await services.exporter.export(miningResult, raw, chunkResult.value);
  if (!exported.ok) return exported;
  // A reusable candidate is recorded only after its graph checkpoint commits.
  if (cacheEnabled && cacheHits === 0) {
    const cacheSet = await services.cache.set(cacheKey, JSON.stringify(miningResult));
    if (cacheSet.ok) cacheWrites += 1;
    else console.warn(`pipeline cache write failed for ${cacheKey}: ${cacheSet.error.message}`);
  }

  const references = services.referenceExtractor
    ? await services.referenceExtractor.extract(exported.value.resourceId)
    : { ok: true as const, value: NO_REFERENCES };
  if (!references.ok) return references;

  const classification = services.classifier
    ? await services.classifier.classify({
      raw,
      resourceId: exported.value.resourceId,
      excerptIds: exported.value.excerptIds,
      claimIds: exported.value.claimIds,
      claims: miningResult.claims,
      chunks: chunkResult.value,
      context,
      config: services.config,
    })
    : { ok: true as const, value: { status: 'disabled' as const, tagsMatched: 0, tagsAssigned: 0, warnings: [] } };
  if (!classification.ok) return classification;

  return {
    ok: true,
    value: {
      sourceId: vector.sourceId,
      canonicalId: raw.canonicalId,
      resourceId: exported.value.resourceId,
      excerptCount: exported.value.excerptIds.length,
      chunkCount: chunkResult.value.length,
      segmentCount: segments.length,
      segments,
      chunks: chunkResult.value,
      excerptIds: exported.value.excerptIds,
      claimsExtracted: miningResult.claims.length,
      claimIds: exported.value.claimIds,
      claims: miningResult.claims,
      ...(miningResult.rejectedClaims ? { rejectedClaims: miningResult.rejectedClaims } : {}),
      ...(miningResult.supportingUnits ? { supportingUnits: miningResult.supportingUnits } : {}),
      ...(miningResult.distillation ? { sourceDistillation: miningResult.distillation } : {}),
      ...(exported.value.extractionSnapshot ? { extractionSnapshot: exported.value.extractionSnapshot } : {}),
      dedupAction: exported.value.dedupAction,
      policyRoute: runtimePolicy.value,
      cacheHits,
      cacheWrites,
      tokenUsage,
      spendUsd,
      warnings: [...warningMessages, ...classification.value.warnings],
      classification: classification.value,
      metadataConflictCount: exported.value.metadataConflictCount,
      references: references.value,
      durationMs: Math.max(0, services.clock.now().getTime() - startMs),
    },
  };
}
