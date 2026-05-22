import { describe, expect, it } from 'vitest';
import { composeVector } from '../../src/index.js';
import type { IDecodeStrategy, IIngestor, RawSource, Result } from '../../src/index.js';

function makeVector(sourceId: string, chunking: 'token-window' | 'section' | 'conversation' | 'highlight') {
  const ingestor: IIngestor = {
    sourceId,
    async acquire(): Promise<Result<RawSource>> {
      return {
        ok: true,
        value: {
          canonicalId: `${sourceId}:fixture`,
          sourceType: sourceId,
          sensitivity: 'public',
          provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: sourceId },
          payload: {},
          label: sourceId,
        },
      };
    },
  };
  const decode: IDecodeStrategy = { name: 'test', async decode() { return { ok: true, value: { segments: [{ id: 'seg-1', text: 'chunking policy fixture text', locator: { kind: 'text', charStart: 0, charEnd: 29 } }], warnings: [] } }; } };
  return composeVector({
    sourceId,
    sensitivity: 'public',
    ingestor,
    decode: [decode],
    context: { async build() { return {}; } },
    chunking,
    registration: { sourceId, validateActiveSourceConfig: value => value },
  });
}

describe('chunking policy', () => {
  it.each([
    ['web', 'token-window', 'token-window'],
    ['pdf', 'section', 'section'],
    ['meeting', 'conversation', 'conversation'],
    ['readwise', 'highlight', 'highlight'],
  ] as const)('%s uses %s chunking through composition', (_sourceId, chunking, expectedName) => {
    const vector = makeVector(_sourceId, chunking);
    expect(vector.chunking.name).toBe(expectedName);
  });
});
