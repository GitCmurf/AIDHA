// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { composeVector } from '../../src/compose/vector.js';
import type { VectorSpec } from '../../src/compose/vector.js';
import type { IIngestor, IDecodeStrategy, IContextProvider, IngestInput } from '../../src/interfaces/index.js';
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
    const result = await vec.ingestAndDecode({ ref: 'https://example.com/page' });
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
    const result = await vec.ingestAndDecode({ ref: 'https://example.com/page' });
    expect(result.ok).toBe(false);
  });
});
