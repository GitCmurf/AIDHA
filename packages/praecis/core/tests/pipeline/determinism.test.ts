import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { composeVector, createDefaultPipelineServices, createIngestionRuntimeFromServices } from '../../src/index.js';
import type { IDecodeStrategy, IIngestor, RawSource, Result } from '../../src/index.js';

function makeVector() {
  const raw: RawSource = {
    canonicalId: 'web:https://example.com/deterministic',
    sourceType: 'web',
    sensitivity: 'public',
    provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'web' },
    payload: {},
    label: 'Deterministic',
  };
  const ingestor: IIngestor = { sourceId: 'web', async acquire(): Promise<Result<RawSource>> { return { ok: true, value: raw }; } };
  const decode: IDecodeStrategy = {
    name: 'test',
    async decode() {
      return { ok: true, value: { segments: [{ id: 'seg-1', text: 'Deterministic fixture claim should remain byte stable.', locator: { kind: 'text', charStart: 0, charEnd: 55 } }], warnings: [] } };
    },
  };
  return composeVector({
    sourceId: 'web',
    sensitivity: 'public',
    ingestor,
    decode: [decode],
    context: { async build() { return {}; } },
    chunking: 'token-window',
    registration: { sourceId: 'web', validateActiveSourceConfig: value => value },
  });
}

describe('determinism', () => {
  it('rerunning the same fixture produces a byte-stable graph snapshot after the first write', async () => {
    const store = new InMemoryStore();
    const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, allowHeuristicFallback: true }));
    const vector = makeVector();

    const first = await runtime.runVector(vector, { ref: 'fixture' });
    expect(first.ok).toBe(true);
    const snapshotOne = await store.exportSnapshot();
    expect(snapshotOne.ok).toBe(true);

    const second = await runtime.runVector(vector, { ref: 'fixture' });
    expect(second.ok).toBe(true);
    const snapshotTwo = await store.exportSnapshot();
    expect(snapshotTwo.ok).toBe(true);

    expect(JSON.stringify(snapshotTwo)).toBe(JSON.stringify(snapshotOne));
  });
});
