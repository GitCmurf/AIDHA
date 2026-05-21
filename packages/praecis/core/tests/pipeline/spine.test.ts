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
          segments: [{ id: 'seg-1', locator: { kind: 'text', charStart: 0, charEnd: 10 }, text: 'hello world' }],
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
    store: {} as PipelineServices['store'],
    miner: {
      async mine() {
        return {
          ok: true,
          value: [{ id: 'claim-1' }, { id: 'claim-2' }],
        };
      },
    },
    editor: {
      async edit(miningResult) {
        return { ok: true, value: miningResult };
      },
    },
    exporter: {
      async export(editResult) {
        return { ok: true, value: editResult };
      },
    },
    llm: {
      async complete() {
        return { ok: true, value: 'ok' };
      },
    },
    cache: {
      async get() {
        return { ok: true, value: null };
      },
      async set() {
        return { ok: true, value: undefined };
      },
    },
    costCeiling: {},
    privacy: { allowCloudLlm: true, sensitivityCeiling: 'confidential' },
  };

  it('run() returns RunReport on success', async () => {
    const runtime = createPipelineRuntime({} as Parameters<typeof createPipelineRuntime>[0]);
    runtime.register(vec);
    const result = await runtime.run('test-source', { ref: 'https://example.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.sourceId).toBe('test-source');
    expect(result.value.canonicalId).toBe('web:https://example.com');
    expect(result.value.claimsExtracted).toBe(0);
    expect(Array.isArray(result.value.warnings)).toBe(true);
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
