// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { composeVector } from '../../src/compose/vector.js';
import { createPipelineRuntime } from '../../src/compose/runtime.js';
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

describe('pipeline spine (via PipelineRuntime.run)', () => {
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
    const runtime = createPipelineRuntime({ config: testConfig(), llm: fakeLlm() });
    runtime.register(vec);
    const result = await runtime.run('test-source', { ref: 'https://example.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.sourceId).toBe('test-source');
    expect(result.value.canonicalId).toBe('web:https://example.com');
    expect(result.value.claimsExtracted).toBeGreaterThan(0);
    expect(result.value.claimIds.length).toBe(result.value.claimsExtracted);
    expect(Array.isArray(result.value.warnings)).toBe(true);
    expect(result.value.classification).toEqual({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0, warnings: [] });
    expect(result.value.metadataConflictCount).toBe(0);
    expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('run() uses PipelineServices when provided and reports extracted claims', async () => {
    const runtime = createPipelineRuntime(services);
    runtime.register(vec);
    const result = await runtime.run('test-source', { ref: 'https://example.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.claimsExtracted).toBe(2);
  });

  it('run() returns err for unknown sourceId', async () => {
    const runtime = createPipelineRuntime({} as Parameters<typeof createPipelineRuntime>[0]);
    const result = await runtime.run('unknown', { ref: 'x' });
    expect(result.ok).toBe(false);
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
    const runtime = createPipelineRuntime({} as Parameters<typeof createPipelineRuntime>[0]);
    runtime.register(failVec);
    const result = await runtime.run('fail', { ref: 'x' });
    expect(result.ok).toBe(false);
  });
});
