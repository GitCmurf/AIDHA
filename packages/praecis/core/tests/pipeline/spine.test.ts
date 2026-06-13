// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { composeVector } from '../../src/compose/vector.js';
import { createIngestionRuntimeFromServices } from '../../src/compose/ingestion-runtime.js';
import { partitionMiningResult } from '../../src/pipeline/spine.js';
import type {
  IIngestor,
  IDecodeStrategy,
  IContextProvider,
  IngestInput,
  ExtractionContext,
  PipelineServices,
} from '../../src/interfaces/index.js';
import type { RawSource, DecodeOutput } from '../../src/types/index.js';
import type { Result } from '@aidha/taxonomy';
import type { SourceRegistration, ResolvedConfig } from '@aidha/config';
import { InMemoryStore } from '@aidha/graph-backend';
import { GraphPipelineExporter, MemoryCache, SystemClock } from '../../src/pipeline/services.js';
import type { LlmClient } from '../../src/extract/index.js';

function makeRegistration(sourceId: string): SourceRegistration {
  return { sourceId, validateActiveSourceConfig: (v) => v };
}

function makeIngestor(sourceId: string): IIngestor {
  return {
    sourceId,
    async acquire(input: IngestInput): Promise<Result<RawSource>> {
      return {
        ok: true,
        value: {
          canonicalId: `web:${input.ref}`,
          sourceType: 'web',
          sensitivity: 'public',
          provenance: { ingestedAt: new Date().toISOString(), sourceType: 'web' },
          payload: {},
          label: input.ref,
        },
      };
    },
  };
}

function makeDecodeStrategy(): IDecodeStrategy {
  return {
    name: 'test-decode',
    async decode(): Promise<Result<DecodeOutput>> {
      return {
        ok: true,
        value: {
          segments: [{
            id: 'seg-1',
            locator: { kind: 'text', charStart: 0, charEnd: 91 },
            text: 'The fixture describes a source that makes synthesized claims for review using clear evidence.',
          }],
          warnings: [],
        },
      };
    },
  };
}

function makeConfigCapturingDecodeStrategy(captured: ResolvedConfig[]): IDecodeStrategy {
  return {
    name: 'capture-runtime-config',
    async decode(input): Promise<Result<DecodeOutput>> {
      captured.push(input.config);
      return makeDecodeStrategy().decode(input);
    },
  };
}

function makeContextProvider(): IContextProvider {
  return {
    async build(_raw: RawSource, _cfg: ResolvedConfig): Promise<ExtractionContext> {
      return {};
    },
  };
}

function testConfig(): ResolvedConfig {
  return {
    baseDir: process.cwd(),
    db: ':memory:',
    llm: {
      model: 'test-model',
      apiKey: '',
      baseUrl: 'http://localhost/v1',
      timeoutMs: 1000,
      cacheDir: '',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      embeddingBatchSize: 20,
      embeddingTaskType: 'SEMANTIC_SIMILARITY',
      embeddingOutputDimensionality: 768,
    },
    editor: {
      version: 'v2',
      windowMinutes: 5,
      maxPerWindow: 3,
      minWindows: 1,
      minWords: 1,
      minChars: 1,
      editorLlm: false,
    },
    extraction: {
      maxClaims: 3,
      chunkMinutes: 5,
      maxChunks: 0,
      promptVersion: 'v2',
    },
    export: { outDir: './out', sourcePrefix: 'test' },
  };
}

function fakeLlm(): LlmClient {
  return {
    async generate(request) {
      const excerptId = /"id":\s*"([^"]+)"/.exec(request.user)?.[1] ?? 'chunk-0';
      return {
        ok: true,
        value: JSON.stringify({
          claims: [{
            text: 'The source provides clear evidence for reviewable synthesized claims.',
            excerptIds: [excerptId],
            confidence: 0.82,
            type: 'fact',
            classification: 'fact',
            startSeconds: 0,
            evidenceType: 'direct',
            why: 'Synthesizes the fixture into a reviewable assertion.',
          }],
        }),
      };
    },
  };
}

describe('pipeline spine (via ConfiguredIngestionRuntime.runVector)', () => {
  const vec = composeVector({
    sourceId: 'test-source',
    sensitivity: 'public',
    ingestor: makeIngestor('test-source'),
    decode: [makeDecodeStrategy()],
    context: makeContextProvider(),
    chunking: 'token-window',
    registration: makeRegistration('test-source'),
  });

  const services: PipelineServices = {
    store: new InMemoryStore(),
    miner: {
      async mine() {
        return {
          ok: true,
          value: {
            claims: [
              { id: 'claim-1', text: 'Claim one is specific enough to persist.', excerptIds: ['chunk-0'], state: 'draft' },
              { id: 'claim-2', text: 'Claim two is specific enough to persist.', excerptIds: ['chunk-0'], state: 'draft' },
            ],
          },
        };
      },
    },
    exporter: {
      async export(miningResult, raw, chunks) {
        return new GraphPipelineExporter(services.store).export(miningResult, raw, chunks);
      },
    },
    llm: {
      async generate() {
        return { ok: true, value: 'ok' };
      },
    },
    costCeiling: {},
    cache: new MemoryCache(),
    privacy: { defaultRoute: 'local', routes: { confidential: 'local' } },
    clock: new SystemClock(),
    config: testConfig(),
    allowHeuristicFallback: false,
  };

  it('run() returns RunReport on success', async () => {
    const runtime = createIngestionRuntimeFromServices({
      ...services,
      store: new InMemoryStore(),
      config: testConfig(),
      llm: fakeLlm(),
    });
    const result = await runtime.runVector(vec, { ref: 'https://example.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.sourceId).toBe('test-source');
    expect(result.value.canonicalId).toBe('web:https://example.com');
    expect(result.value.claimsExtracted).toBeGreaterThan(0);
    expect(result.value.claimIds.length).toBe(result.value.claimsExtracted);
    expect(Array.isArray(result.value.warnings)).toBe(true);
    expect(result.value.classification).toEqual({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0, warnings: [] });
    expect(result.value.metadataConflictCount).toBe(0);
    expect(result.value.references).toEqual({
      referencesCreated: 0,
      referencesUpdated: 0,
      referencesNoop: 0,
      referenceEdgesCreated: 0,
      referenceEdgesUpdated: 0,
      referenceEdgesNoop: 0,
    });
    expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('run() uses PipelineServices when provided and reports extracted claims', async () => {
    const runtime = createIngestionRuntimeFromServices(services);
    const result = await runtime.runVector(vec, { ref: 'https://example.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.claimsExtracted).toBe(2);
  });

  it('keeps rejected candidates as diagnostics without exporting them as claims', async () => {
    const store = new InMemoryStore();
    const runtime = createIngestionRuntimeFromServices({
      ...services,
      store,
      cache: new MemoryCache(),
      miner: {
        async mine() {
          return {
            ok: true as const,
            value: {
              claims: [
                { id: 'claim-reviewable', text: 'Reviewable claim persists.', excerptIds: ['chunk-0'], state: 'draft' as const, metadata: { qualityStatus: 'reviewable' } },
                { id: 'claim-rejected', text: 'The speaker claims this diagnostic should not persist.', excerptIds: ['chunk-0'], state: 'draft' as const, metadata: { qualityStatus: 'rejected' } },
              ],
            },
          };
        },
      },
      exporter: {
        async export(miningResult, raw, chunks) {
          return new GraphPipelineExporter(store).export(miningResult, raw, chunks);
        },
      },
    });

    const result = await runtime.runVector(vec, { ref: 'https://example.com/rejected' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.claims.map(claim => claim.id)).toEqual(['claim-reviewable']);
    expect(result.value.rejectedClaims.map(claim => claim.id)).toEqual(['claim-rejected']);
    expect(result.value.qualitySummary).toEqual({ total: 2, reviewable: 1, rejected: 1 });
    expect(result.value.claimIds).toEqual(['claim-reviewable']);

    const rejectedNode = await store.getNode('claim-rejected');
    expect(rejectedNode.ok).toBe(true);
    if (!rejectedNode.ok) throw rejectedNode.error;
    expect(rejectedNode.value).toBeNull();
  });

  it('passes PipelineServices.config into vector decode', async () => {
    const captured: ResolvedConfig[] = [];
    const config = { ...testConfig(), activeSourceConfig: { decodeFlag: true } };
    const runtime = createIngestionRuntimeFromServices({ ...services, config });
    const vector = composeVector({
      sourceId: 'config-source',
      sensitivity: 'public',
      ingestor: makeIngestor('config-source'),
      decode: [makeConfigCapturingDecodeStrategy(captured)],
      context: makeContextProvider(),
      chunking: 'token-window',
      registration: makeRegistration('config-source'),
    });

    const result = await runtime.runVector(vector, { ref: 'https://example.com' });

    expect(result.ok).toBe(true);
    expect(captured).toEqual([config]);
  });

  it('run() returns err when ingestor fails', async () => {
    const failIngestor: IIngestor = {
      sourceId: 'fail',
      async acquire(): Promise<Result<RawSource>> {
        return { ok: false, error: new Error('network error') };
      },
    };
    const failVec = composeVector({
      sourceId: 'fail',
      sensitivity: 'public',
      ingestor: failIngestor,
      decode: [makeDecodeStrategy()],
      context: makeContextProvider(),
      chunking: 'token-window',
      registration: makeRegistration('fail'),
    });
    const runtime = createIngestionRuntimeFromServices(services);
    const result = await runtime.runVector(failVec, { ref: 'x' });
    expect(result.ok).toBe(false);
  });

  it('passes supportingUnits and sourceDistillation from MiningResult into RunReport', async () => {
    const store = new InMemoryStore();
    const supportingUnits = [{ id: 'su-1', kind: 'example' as const, text: 'Supporting context.', supportsUnitIds: ['claim-1'], excerptIds: ['chunk-0'] }];
    const distillation = {
      failedClosed: false as const,
      sourceType: 'tutorial' as const,
      sourcePurpose: 'Explains a concept.',
      sourceCoherence: 'single_topic' as const,
      theses: ['Main thesis.'],
      coverage: {
        citedExcerptCount: 1,
        excerptsCitedPercent: 100,
        citedTextPercent: 100,
        largestUncitedGapSeconds: 0,
        coreUnitsWithoutVerifiedEvidence: 0,
        weakQuoteCount: 0,
      },
      unitCountsByKind: { idea: 1 },
      relations: [],
      diagnostics: [],
    };
    const runtime = createIngestionRuntimeFromServices({
      ...services,
      store,
      cache: new MemoryCache(),
      miner: {
        async mine() {
          return {
            ok: true as const,
            value: {
              claims: [{ id: 'claim-1', text: 'Distilled claim from source.', excerptIds: ['chunk-0'], state: 'draft' as const }],
              rejectedClaims: [{ id: 'claim-rejected', text: 'Rejected by distillation.', excerptIds: ['chunk-0'], state: 'draft' as const }],
              supportingUnits,
              distillation,
            },
          };
        },
      },
      exporter: {
        async export(miningResult, raw, chunks) {
          return new GraphPipelineExporter(store).export(miningResult, raw, chunks);
        },
      },
    });

    const result = await runtime.runVector(vec, { ref: 'https://example.com/distilled' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    // claims are pre-partitioned by the miner
    expect(result.value.claims.map(c => c.id)).toEqual(['claim-1']);
    expect(result.value.rejectedClaims.map(c => c.id)).toEqual(['claim-rejected']);
    expect(result.value.qualitySummary).toEqual({ total: 2, reviewable: 1, rejected: 1 });

    // pass-through fields
    expect(result.value.supportingUnits).toEqual(supportingUnits);
    expect(result.value.sourceDistillation).toEqual(distillation);
  });
});

describe('partitionMiningResult', () => {
  it('uses pre-partitioned rejectedClaims when present (distillation path)', () => {
    const reviewable = { id: 'c-1', text: 'Kept.', excerptIds: [], state: 'draft' as const };
    const rejected = { id: 'c-2', text: 'Rejected.', excerptIds: [], state: 'draft' as const };
    const result = partitionMiningResult({
      claims: [reviewable],
      rejectedClaims: [rejected],
    });
    expect(result.reviewableClaims).toEqual([reviewable]);
    expect(result.rejectedClaims).toEqual([rejected]);
  });

  it('partitions by qualityStatus metadata when rejectedClaims is undefined (legacy path)', () => {
    const reviewable = { id: 'c-1', text: 'Kept.', excerptIds: [], state: 'draft' as const, metadata: { qualityStatus: 'reviewable' } };
    const rejected = { id: 'c-2', text: 'Rejected.', excerptIds: [], state: 'draft' as const, metadata: { qualityStatus: 'rejected' } };
    const result = partitionMiningResult({
      claims: [reviewable, rejected],
      // rejectedClaims intentionally absent
    });
    expect(result.reviewableClaims).toEqual([reviewable]);
    expect(result.rejectedClaims).toEqual([rejected]);
  });

  it('returns empty rejectedClaims when all claims are reviewable (legacy path, no metadata)', () => {
    const claim = { id: 'c-1', text: 'Normal claim.', excerptIds: [], state: 'draft' as const };
    const result = partitionMiningResult({ claims: [claim] });
    expect(result.reviewableClaims).toEqual([claim]);
    expect(result.rejectedClaims).toEqual([]);
  });
});
