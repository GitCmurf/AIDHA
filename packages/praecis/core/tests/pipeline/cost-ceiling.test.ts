import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { composeVector, createDefaultPipelineServices, createIngestionRuntimeFromServices } from '../../src/index.js';
import type { IDecodeStrategy, IIngestor, LlmCompletionRequest, RawSource, Result } from '../../src/index.js';

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
  afterEach(() => { vi.unstubAllEnvs(); });
  it('fails before export and leaves no partial claims when token ceiling is exceeded', async () => {
    const store = new InMemoryStore();
    const exporter = { export: vi.fn(async () => ({ ok: true as const, value: { resourceId: 'x', excerptIds: [], claimIds: [], dedupAction: 'create' as const, metadataConflictCount: 0, created: 0, updated: 0, noop: 0 } })) };
    const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({
      store,
      exporter,
      miner: { async mine() { return { ok: true as const, value: { tokenUsage: 99, claims: [{ id: 'claim-cost', text: 'A claim that should not be exported.', excerptIds: ['seg-1'], state: 'draft' as const }] } }; } },
      costCeiling: { maxTokens: 10 },
    }));

    const result = await runtime.runVector(makeVector(), { ref: 'x' });

    expect(result.ok).toBe(false);
    expect(exporter.export).not.toHaveBeenCalled();
    const claims = await store.queryNodes({ type: 'Claim' });
    expect(claims.ok && claims.value.items).toEqual([]);
  });

  it('enforces post-mine ceilings against actual provider token usage', async () => {
    // Legacy chunk-mining path: SourceDistillationMiner catches the ceiling internally
    // before returning; this test covers the post-mine cost check on the legacy extractor.
    vi.stubEnv('AIDHA_EXTRACTION_PATH', 'chunk-mining');
    const store = new InMemoryStore();
    const exporter = { export: vi.fn(async () => ({ ok: true as const, value: { resourceId: 'x', excerptIds: [], claimIds: [], dedupAction: 'create' as const, metadataConflictCount: 0, created: 0, updated: 0, noop: 0 } })) };
    const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({
      store,
      exporter,
      llm: {
        async generate(request: LlmCompletionRequest) {
          const excerptId = request.user.match(/\bseg-[a-f0-9]{16}\b/u)?.[0] ?? 'seg-1';
          return {
            ok: true as const,
            value: JSON.stringify({
              claims: [{
                text: 'Actual provider usage can exceed the preflight estimate.',
                excerptIds: [excerptId],
                type: 'claim',
                classification: 'fact',
                confidence: 0.9,
                method: 'llm',
              }],
            }),
            usage: { inputTokens: 70, outputTokens: 30, totalTokens: 100 },
          };
        },
      },
      config: {
        ...createDefaultPipelineServices({ store }).config,
        llm: {
          ...createDefaultPipelineServices({ store }).config.llm,
          model: 'test-llm',
          cacheDir: `./out/cache/cost-ceiling-${Date.now()}`,
        },
      },
      costCeiling: { maxTokens: 90 },
    }));

    const result = await runtime.runVector(makeVector(), { ref: 'x' });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('200 tokens > 90');
    expect(exporter.export).not.toHaveBeenCalled();
  });
});
