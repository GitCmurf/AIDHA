import { describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { composeVector, createDefaultPipelineServices, createPipelineRuntime } from '../../src/index.js';
import type { IDecodeStrategy, IIngestor, RawSource, Result } from '../../src/index.js';

function makeVector() {
  const ingestor: IIngestor = {
    sourceId: 'web',
    async acquire(): Promise<Result<RawSource>> {
      return {
        ok: true,
        value: {
          canonicalId: 'web:https://example.com/cost',
          sourceType: 'web',
          sensitivity: 'public',
          provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'web' },
          payload: {},
          label: 'cost',
        },
      };
    },
  };
  const decode: IDecodeStrategy = {
    name: 'test',
    async decode() {
      return { ok: true, value: { segments: [{ id: 'seg-1', text: 'Cost ceiling should prevent partial claim writes.', locator: { kind: 'text', charStart: 0, charEnd: 48 } }], warnings: [] } };
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

describe('cost ceiling', () => {
  it('fails before export and leaves no partial claims when token ceiling is exceeded', async () => {
    const store = new InMemoryStore();
    const exporter = { export: vi.fn(async () => ({ ok: true as const, value: { resourceId: 'x', excerptIds: [], claimIds: [], dedupAction: 'create' as const, created: 0, updated: 0, noop: 0 } })) };
    const runtime = createPipelineRuntime(createDefaultPipelineServices({
      store,
      exporter,
      miner: { async mine() { return { ok: true as const, value: { tokenUsage: 99, claims: [{ id: 'claim-cost', text: 'A claim that should not be exported.', excerptIds: ['seg-1'], state: 'draft' as const }] } }; } },
      costCeiling: { maxTokens: 10 },
    }));

    runtime.register(makeVector());
    const result = await runtime.run('web', { ref: 'x' });

    expect(result.ok).toBe(false);
    expect(exporter.export).not.toHaveBeenCalled();
    const claims = await store.queryNodes({ type: 'Claim' });
    expect(claims.ok && claims.value.items).toEqual([]);
  });
});
