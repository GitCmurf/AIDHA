// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { composeVector, transcribeStrategy, diarizeStrategy } from '../../src/compose/vector.js';
import type { VectorSpec } from '../../src/compose/vector.js';
import type { VectorRuntimeContext } from '../../src/compose/vector.js';
import { createPipelineRuntime } from '../../src/compose/runtime.js';
import { createIngestionRuntime } from '../../src/compose/ingestion-runtime.js';
import type { IIngestor, IDecodeStrategy, IContextProvider, IngestInput, ITranscriber, IDiarizer, TimecodedSegment, AudioRef, TranscribeOptions } from '../../src/interfaces/index.js';
import type { RawSource, DecodeOutput, ExtractionContext } from '../../src/types/index.js';
import type { Result } from '@aidha/taxonomy';
import type { SourceRegistration, ResolvedConfig } from '@aidha/config';

// Minimal stub for SourceRegistration
function makeRegistration(sourceId: string): SourceRegistration {
  return {
    sourceId,
    validateActiveSourceConfig: (v) => v,
  };
}

// Minimal stub config for decode strategies
const stubConfig = {} as ResolvedConfig;
const runtimeContext: VectorRuntimeContext = {
  config: stubConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

function makeIngestor(sourceId: string, payload: unknown = {}): IIngestor {
  return {
    sourceId,
    async acquire(input: IngestInput): Promise<Result<RawSource & { payload: unknown }>> {
      return {
        ok: true,
        value: {
          canonicalId: `web:${input.ref}`,
          sourceType: 'web',
          sensitivity: 'public',
          provenance: { ingestedAt: new Date().toISOString(), sourceType: 'web' },
          payload,
          label: input.ref,
        },
      };
    },
  };
}

function makeFailingIngestor(): IIngestor {
  return {
    sourceId: 'fail-source',
    async acquire(): Promise<Result<RawSource & { payload: unknown }>> {
      return { ok: false, error: new Error('network error') };
    },
  };
}

function makeDecodeStrategy(name: string, segments = 1): IDecodeStrategy {
  return {
    name,
    async decode(): Promise<Result<DecodeOutput>> {
      return {
        ok: true,
        value: {
          segments: Array.from({ length: segments }, (_, i) => ({
            id: `seg-${name}-${i}`,
            locator: { kind: 'text', charStart: 0, charEnd: 10 },
            text: 'hello world',
          })),
          warnings: [],
        },
      };
    },
  };
}

function makeConfigCapturingDecodeStrategy(captured: ResolvedConfig[]): IDecodeStrategy {
  return {
    name: 'capture-config',
    async decode(input): Promise<Result<DecodeOutput>> {
      captured.push(input.config);
      return {
        ok: true,
        value: {
          segments: [{
            id: 'seg-config',
            locator: { kind: 'text', charStart: 0, charEnd: 10 },
            text: 'hello world',
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

function makeSpec(overrides?: Partial<VectorSpec>): VectorSpec {
  return {
    sourceId: 'test-source',
    sensitivity: 'public',
    ingestor: makeIngestor('test-source'),
    decode: [makeDecodeStrategy('html')],
    context: makeContextProvider(),
    chunking: 'token-window',
    registration: makeRegistration('test-source'),
    ...overrides,
  };
}

describe('composeVector', () => {
  it('1. Valid spec produces ComposedVector with frozen decode array', () => {
    const vec = composeVector(makeSpec());
    expect(vec.sourceId).toBe('test-source');
    expect(vec.decode).toHaveLength(1);
    // Frozen — cannot push to it (readonly at TS level; runtime via Object.freeze)
    expect(Object.isFrozen(vec.decode)).toBe(true);
  });

  it('2. Empty decode chain throws', () => {
    expect(() => composeVector(makeSpec({ decode: [] }))).toThrow(
      'VectorSpec.decode must have at least one strategy'
    );
  });

  it('3. sourceId mismatch between spec and registration throws', () => {
    expect(() =>
      composeVector(makeSpec({ registration: makeRegistration('other-source') }))
    ).toThrow();
  });

  it('4. ingestAndDecode returns raw + segments + warnings on success', async () => {
    const vec = composeVector(makeSpec());
    const result = await vec.ingestAndDecode({ ref: 'https://example.com/page' }, runtimeContext);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.raw).toBeDefined();
    expect(result.value.segments.length).toBeGreaterThan(0);
    expect(Array.isArray(result.value.warnings)).toBe(true);
  });

  it('5. ingestAndDecode when acquire fails returns Result.err', async () => {
    const vec = composeVector(
      makeSpec({
        sourceId: 'fail-source',
        ingestor: makeFailingIngestor(),
        registration: makeRegistration('fail-source'),
      })
    );
    const result = await vec.ingestAndDecode({ ref: 'https://example.com/page' }, runtimeContext);
    expect(result.ok).toBe(false);
  });

  it('passes the runtime config into decode strategies', async () => {
    const captured: ResolvedConfig[] = [];
    const vec = composeVector(makeSpec({ decode: [makeConfigCapturingDecodeStrategy(captured)] }));
    const config = { ...stubConfig, activeSourceConfig: { decodeFlag: true } };

    const result = await vec.ingestAndDecode(
      { ref: 'https://example.com/page' },
      { ...runtimeContext, config },
    );

    expect(result.ok).toBe(true);
    expect(captured).toEqual([config]);
  });
});

describe('transcribeStrategy adapter', () => {
  function makeTranscriber(): ITranscriber {
    return {
      backend: 'mock',
      async transcribe(_audio: AudioRef, _opts: TranscribeOptions): Promise<Result<TimecodedSegment[]>> {
        return {
          ok: true,
          value: [{ id: 'seg-1', startSec: 0, endSec: 5, text: 'hello', speaker: 'A' }],
        };
      },
    };
  }

  it('wraps ITranscriber and returns timecoded MediaSegments', async () => {
    const strategy = transcribeStrategy(makeTranscriber());
    expect(strategy.name).toContain('transcribe');
    const result = await strategy.decode({
      raw: {
        canonicalId: 'test:1',
        sourceType: 'voice',
        sensitivity: 'personal',
        provenance: { ingestedAt: new Date().toISOString(), sourceType: 'voice' },
        payload: { uri: 'file:///audio.mp3', mimeType: 'audio/mpeg' },
        label: 'test',
      },
      config: {} as ResolvedConfig,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments).toHaveLength(1);
    expect(result.value.segments[0]!.locator.kind).toBe('timecode');
  });
});

describe('diarizeStrategy adapter', () => {
  function makeDiarizer(): IDiarizer {
    return {
      backend: 'mock',
      async diarize(_audio: AudioRef, segments: TimecodedSegment[]): Promise<Result<TimecodedSegment[]>> {
        return { ok: true, value: segments.map(s => ({ ...s, speaker: 'Speaker-A' })) };
      },
    };
  }

  const audioPayload = { uri: 'file:///audio.mp3', mimeType: 'audio/mpeg' };
  const mockRaw: RawSource = {
    canonicalId: 'test:1',
    sourceType: 'meeting',
    sensitivity: 'confidential',
    provenance: { ingestedAt: new Date().toISOString(), sourceType: 'meeting' },
    payload: audioPayload,
    label: 'test',
  };

  it('throws (not Result.err) when upstream is undefined', async () => {
    const strategy = diarizeStrategy(makeDiarizer());
    const result = await strategy.decode({ raw: mockRaw, config: {} as ResolvedConfig });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('upstream');
  });

  it('annotates upstream timecoded segments with speaker labels', async () => {
    const strategy = diarizeStrategy(makeDiarizer());
    const result = await strategy.decode({
      raw: mockRaw,
      upstream: [{ id: 'seg-0', locator: { kind: 'timecode', startSec: 0, endSec: 5 }, text: 'hi' }],
      config: {} as ResolvedConfig,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments[0]!.label).toBe('Speaker-A');
  });
});

describe('createPipelineRuntime', () => {
  it('register throws on duplicate sourceId', () => {
    const runtime = createPipelineRuntime({} as Parameters<typeof createPipelineRuntime>[0]);
    const mockVector = composeVector(makeSpec());
    runtime.register(mockVector);
    expect(() => runtime.register(mockVector)).toThrow('duplicate sourceId');
  });

  it('run() returns err for unregistered sourceId', async () => {
    const runtime = createPipelineRuntime({} as Parameters<typeof createPipelineRuntime>[0]);
    const result = await runtime.run('any', { ref: 'x' });
    expect(result.ok).toBe(false);
  });
});

describe('createIngestionRuntime', () => {
  it('runVector executes the supplied vector even when sourceId repeats', async () => {
    const runtime = await createIngestionRuntime({ allowHeuristicFallback: true });
    expect(runtime.ok).toBe(true);
    if (!runtime.ok) throw runtime.error;
    try {
      const first = composeVector(makeSpec());
      const second = composeVector(makeSpec({
        ingestor: makeIngestor('test-source', { variant: 'second' }),
        decode: [makeDecodeStrategy('plain-text')],
      }));

      const firstResult = await runtime.value.runVector(first, { ref: 'one' });
      const secondResult = await runtime.value.runVector(second, { ref: 'two' });

      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) throw firstResult.error;
      expect(secondResult.ok).toBe(true);
      if (!secondResult.ok) throw secondResult.error;
      expect(firstResult.value.canonicalId).toBe('web:one');
      expect(secondResult.value.canonicalId).toBe('web:two');
    } finally {
      await runtime.value.close();
    }
  });
});
