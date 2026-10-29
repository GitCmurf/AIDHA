import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { createDefaultPipelineServices, SourceDistillationClosedError, type ICandidateMiner, type MiningResult } from '@aidha/praecis-core';
import { runWebIngest } from '../src/index.js';

const stores: InMemoryStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

const ingestWithMiner = (mine: ICandidateMiner['mine']) => {
  const store = new InMemoryStore();
  stores.push(store);
  const miner: ICandidateMiner = { mine };
  const services = createDefaultPipelineServices({ store, miner });
  return runWebIngest('https://example.test/distillation', async url => ({
    ok: true,
    url,
    status: 200,
    text: async () => '<html><body><article><p>The committee links research documents with explicit references for later review.</p></article></body></html>',
  }), services);
};

describe('public ingestion distillation summary', () => {
  it('throws typed failed-close diagnostics without returning a successful ingestion summary', async () => {
    const distillation = {
      failedClosed: true,
      diagnostics: ['Distillation response failed schema validation after repair.'],
    };

    const error: unknown = await ingestWithMiner(async () => ({
      ok: true, value: { claims: [], distillation, tokenUsage: 27 },
    })).then(
      () => { throw new Error('Failed-close must not return an ingestion summary'); },
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(SourceDistillationClosedError);
    if (!(error instanceof SourceDistillationClosedError)) throw new Error('Expected typed failure');
    expect(error.sourceCanonicalId).toBe('web:https://example.test/distillation');
    expect(error.diagnostics).toEqual(distillation.diagnostics);
    expect(error.summary).toEqual(distillation);
    expect(error.tokenUsage).toBe(27);
    const store = stores.at(-1);
    if (!store) throw new Error('Expected the caller-owned graph store');
    const nodes = await store.queryNodes();
    if (!nodes.ok) throw nodes.error;
    expect(nodes.value.items).toEqual([]);
  });

  it('preserves qualified untrusted claims, supporting evidence and rejected units', async () => {
    let mined: MiningResult | undefined;
    const summary = await ingestWithMiner(async ({ chunks }) => {
      const excerptId = chunks[0]?.id;
      if (!excerptId) throw new Error('Expected the real web vector to produce an evidence excerpt');
      const evidence = [{
        excerptId,
        quote: 'The committee links research documents with explicit references for later review.',
        quoteVerification: 'exact',
      }];
      mined = {
        claims: [{
          text: 'Explicit references connect research documents for review.',
          excerptIds: [excerptId],
          state: 'draft',
          metadata: {
            method: 'llm-distill', model: 'synthetic-model', promptVersion: 'distillation-v1',
            unitId: 'retained-idea',
            trusted: false, qualityStatus: 'reviewable', evidence,
            rationale: 'The source describes explicit references.',
            conditions: [{ type: 'scale', text: 'small research collections' }],
            attribution: { kind: 'speaker', role: 'committee chair' },
          },
        }],
        supportingUnits: [{
          id: 'supporting-example', kind: 'example', text: 'The committee reviews linked research documents.',
          supportsUnitIds: ['retained-idea'], excerptIds: [excerptId], evidence,
          stance: 'asserted', importance: 'supporting',
        }],
        rejectedClaims: [{
          text: 'All documents are always linked.', excerptIds: [excerptId], state: 'draft',
          metadata: { trusted: false, qualityStatus: 'rejected', rejectionReason: 'unsupported', evidence },
        }],
        distillation: {
          failedClosed: false, sourceType: 'article', sourcePurpose: 'Describe document references.',
          diagnostics: ['One unsupported assertion was rejected.'],
        },
      };
      return { ok: true, value: mined };
    });

    expect(mined).toBeDefined();
    expect(summary.claimsExtracted).toBe(1);
    expect(summary.claims).toEqual([{
      text: 'Explicit references connect research documents for review.',
      excerptIds: [summary.chunks[0]?.id],
      method: 'llm-distill', model: 'synthetic-model', promptVersion: 'distillation-v1',
      metadata: mined?.claims[0]?.metadata,
    }]);
    expect(summary.supportingUnits).toEqual(mined?.supportingUnits);
    expect(summary.rejectedClaims).toEqual(mined?.rejectedClaims);
    expect(summary.sourceDistillation).toEqual(mined?.distillation);
  });
});
