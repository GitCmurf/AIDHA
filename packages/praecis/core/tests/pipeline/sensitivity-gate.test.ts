import { describe, expect, it, vi } from 'vitest';
import { createDefaultPipelineServices, createIngestionRuntimeFromServices, composeVector } from '../../src/index.js';
import type { IDecodeStrategy, IIngestor, RawSource, Result } from '../../src/index.js';

function vector(rawSensitivity: RawSource['sensitivity'] = 'confidential', declaredSensitivity: RawSource['sensitivity'] = 'confidential') {
  const ingestor: IIngestor = {
    sourceId: 'meeting',
    async acquire(): Promise<Result<RawSource>> {
      return {
        ok: true,
        value: {
          canonicalId: 'meeting:test',
          sourceType: 'meeting',
          sensitivity: rawSensitivity,
          provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'meeting' },
          payload: {},
          label: 'meeting',
        },
      };
    },
  };
  const decode: IDecodeStrategy = {
    name: 'test',
    async decode() {
      return { ok: true, value: { segments: [{ id: 'seg-1', text: 'Confidential launch plan has concrete milestones.', locator: { kind: 'text', charStart: 0, charEnd: 47 } }], warnings: [] } };
    },
  };
  return composeVector({
    sourceId: 'meeting',
    sensitivity: declaredSensitivity,
    ingestor,
    decode: [decode],
    context: { async build() { return {}; } },
    chunking: 'token-window',
    registration: { sourceId: 'meeting', validateActiveSourceConfig: value => value },
  });
}

describe('sensitivity gate', () => {
  it('rejects confidential vectors before acquisition when policy routes them to cloud', async () => {
    const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({ privacy: { defaultRoute: 'cloud' } }));
    const result = await runtime.runVector(vector(), { ref: 'x' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toMatch(/confidential resources/);
  });

  it('blocks confidential resources before mining when runtime policy disables them', async () => {
    const miner = { mine: vi.fn(async () => ({ ok: true as const, value: { claims: [] } })) };
    const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({
      miner,
      privacy: { defaultRoute: 'local', routes: { confidential: 'disabled', public: 'local' } },
    }));

    const result = await runtime.runVector(vector('confidential', 'public'), { ref: 'x' });
    expect(result.ok).toBe(false);
    expect(miner.mine).not.toHaveBeenCalled();
  });
});
