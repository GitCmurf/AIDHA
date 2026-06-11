// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type {
  IngestInput,
  RunReport,
  PipelineServices,
  ExtractionContext,
  MiningResult,
} from '../interfaces/index.js';
import type { ComposedVector } from '../compose/vector.js';
import type { Result } from '@aidha/taxonomy';
import type { DecodeWarning } from '../types/index.js';
import type { ResolvedConfig } from '@aidha/config';
import { createHash } from 'node:crypto';
import { buildSourceSynopsis } from '../extract/source-synopsis.js';

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

function parseMiningResult(value: string): MiningResult | null {
  try {
    const parsed = JSON.parse(value) as MiningResult;
    return Array.isArray(parsed.claims) ? parsed : null;
  } catch {
    return null;
  }
}

function isRejectedClaim(claim: MiningResult['claims'][number]): boolean {
  return claim.metadata?.['qualityStatus'] === 'rejected';
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
  const cacheKey = `pipeline:${raw.canonicalId}:${stableHash(chunkResult.value.map(chunk => [chunk.id, chunk.text]))}`;
  let cacheHits = 0;
  let cacheWrites = 0;

  let miningResult: MiningResult | null = null;
  const cached = await services.cache.get(cacheKey);
  if (!cached.ok) return cached;
  if (cached.value) {
    miningResult = parseMiningResult(cached.value);
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
    const cacheSet = await services.cache.set(cacheKey, JSON.stringify(miningResult));
    if (cacheSet.ok) {
      cacheWrites += 1;
    } else {
      console.warn(`pipeline cache write failed for ${cacheKey}: ${cacheSet.error.message}`);
    }
  }

  const tokenUsage = miningResult.tokenUsage ?? 0;
  const spendUsd = miningResult.spendUsd ?? 0;
  const costCheck = assertWithinCost(services, tokenUsage, spendUsd);
  if (!costCheck.ok) return costCheck;

  const reviewableClaims = miningResult.claims.filter(claim => !isRejectedClaim(claim));
  const rejectedClaims = miningResult.claims.filter(isRejectedClaim);
  const reviewableMiningResult: MiningResult = {
    ...miningResult,
    claims: reviewableClaims,
  };

  const exported = await services.exporter.export(reviewableMiningResult, raw, chunkResult.value);
  if (!exported.ok) return exported;

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
      claims: reviewableClaims,
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
      claimsExtracted: reviewableClaims.length,
      claimIds: exported.value.claimIds,
      claims: reviewableClaims,
      rejectedClaims,
      qualitySummary: {
        total: miningResult.claims.length,
        reviewable: reviewableClaims.length,
        rejected: rejectedClaims.length,
      },
      sourceSynopsis: buildSourceSynopsis({
        sourceId: vector.sourceId,
        canonicalId: raw.canonicalId,
        sourceUri: raw.provenance.sourceUri,
        resourceId: exported.value.resourceId,
        claims: reviewableClaims,
        chunks: chunkResult.value,
      }),
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
