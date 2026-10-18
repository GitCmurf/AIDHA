import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { SourceDistillationMiner, composeVector, createIngestionRuntimeFromServices } from '../../src/index.js';
import { createDefaultPipelineServices, MemoryCache } from '../../src/pipeline/services.js';
import type { ICandidateMiner } from '../../src/interfaces/index.js';
import { RecordingLlm, config, grounded, payload, source, unit } from '../extract/distill/fixture.js';

const vector = composeVector({
  sourceId: 'synthetic', sensitivity: 'public',
  registration: { sourceId: 'synthetic', validateActiveSourceConfig: value => value },
  ingestor: { sourceId: 'synthetic', acquire: async () => ({ ok: true,
    value: { canonicalId: 'synthetic:wiki', sourceType: 'web', sensitivity: 'public', provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} } }) },
  decode: [{ name: 'synthetic', decode: async () => ({ ok: true, value: {
    segments: [{ id: 'seg1', text: source, locator: { kind: 'text', charStart: 0, charEnd: source.length } }], warnings: [] } }) }],
  context: { build: async () => ({}) },
  chunking: { name: 'synthetic-chunks', chunk: async ({ segments }) => ({ ok: true,
    value: [{ id: 'ex1', segments, text: source, locator: { kind: 'text', charStart: 0, charEnd: source.length } }] }) },
});
const stores: InMemoryStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });
const setup = (cache = new MemoryCache(), miner: ICandidateMiner = new SourceDistillationMiner()) => {
  const store = new InMemoryStore(); stores.push(store);
  const llm = new RecordingLlm([payload(), grounded]);
  const services = createDefaultPipelineServices({ store, llm, miner, cache, config: config() });
  return { store, llm, services };
};
const run = async (services: ReturnType<typeof createDefaultPipelineServices>) => {
  const result = await createIngestionRuntimeFromServices(services).runVector(vector, { ref: 'synthetic:wiki' });
  if (!result.ok) throw result.error;
  return result.value;
};

describe('distillation through ConfiguredIngestionRuntime', () => {
  it('exports only retained drafts and returns exact supporting/rejected evidence', async () => {
    const initial = setup(new MemoryCache(), new SourceDistillationMiner({ quoteFailureCloseThreshold: 1 }));
    const store = initial.store;
    const services = { ...initial.services, llm: new RecordingLlm([payload([
      { ...unit, rationale: 'The source describes explicit links.', conditions: [{ type: 'scale', text: 'small collections' }], attribution: { kind: 'speaker', role: 'committee chair' } },
      { ...unit, id: 'u2', kind: 'example', importance: 'supporting', supportsUnitIds: ['u1'] },
      { ...unit, id: 'u3', text: 'This fabricated assertion has no literal source support.', evidence: [{ excerptId: 'ex1', quote: 'these entirely invented words have no source' }] },
    ]), JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }, { unitId: 'u2', verdict: 'grounded' }] })]) };
    const report = await run(services);
    expect(report.claimsExtracted).toBe(1);
    expect(report.claims[0]?.metadata).toMatchObject({ trusted: false, rationale: 'The source describes explicit links.',
      conditions: [{ type: 'scale', text: 'small collections' }], attribution: { kind: 'speaker', role: 'committee chair' } });
    expect(report.supportingUnits).toMatchObject([{ id: 'u2', supportsUnitIds: ['u1'], evidence: [{ excerptId: 'ex1', quoteVerification: 'exact' }] }]);
    expect(report.rejectedClaims).toMatchObject([{ metadata: { unitId: 'u3', rejectionReason: 'failed_quote_verification', trusted: false } }]);
    expect(report.sourceDistillation).toMatchObject({ failedClosed: false, coverage: { citedExcerptCount: 1, weakQuoteCount: 1 } });
    const nodes = await store.queryNodes({ type: 'Claim' });
    expect(nodes.ok && nodes.value.items.length).toBe(1);
  });

  it('does not reuse another miner’s cached extraction', async () => {
    const legacy: ICandidateMiner = { cacheIdentity: 'legacy', mine: async () => ({ ok: true, value: { claims: [] } }) };
    const { services, llm } = setup(new MemoryCache(), legacy);
    await run(services);
    const changed = { ...services, miner: new SourceDistillationMiner() };
    expect((await run(changed)).claimsExtracted).toBe(1);
    expect(llm.requests).toHaveLength(2);
  });

  it('preserves enriched reports on a fresh-runtime cache hit and invalidates changed model/contract', async () => {
    const initial = setup();
    let services = initial.services;
    const llm = initial.llm;
    await run(services);
    const hit = await run(services);
    expect(hit.cacheHits).toBe(1);
    expect(hit.sourceDistillation?.failedClosed).toBe(false);
    expect(llm.requests).toHaveLength(2);
    services.config.llm.model = 'another-synthetic-model';
    services = { ...services, llm: new RecordingLlm([payload(), grounded]) };
    expect((await run(services)).cacheHits).toBe(0);
    const previous = services.miner;
    services = { ...services, miner: { cacheIdentity: `${previous.cacheIdentity}:changed-review`, mine: previous.mine.bind(previous) } };
    services = { ...services, llm: new RecordingLlm([payload(), grounded]) };
    expect((await run(services)).cacheHits).toBe(0);
  });

  it('retries a failed-closed extraction after a fresh runtime', async () => {
    let services = { ...setup().services, llm: new RecordingLlm(['invalid', 'invalid again']) };
    const first = await run(services);
    expect(first.cacheWrites).toBe(0);
    expect(first.sourceDistillation?.failedClosed).toBe(true);
    services = { ...services, llm: new RecordingLlm([payload(), grounded]) };
    const second = await run(services);
    expect(second.claimsExtracted).toBe(1);
    expect(second.cacheHits).toBe(0);
  });
});

it('never shares cache entries between anonymous custom miners', async () => {
  const first: ICandidateMiner = { mine: async () => ({ ok: true, value: { claims: [] } }) };
  const { services } = setup(new MemoryCache(), first);
  await run(services);
  const actual = new SourceDistillationMiner();
  const second: ICandidateMiner = { mine: actual.mine.bind(actual) };
  const result = await run({ ...services, miner: second });
  expect(result.claimsExtracted).toBe(1);
  expect(result.cacheHits).toBe(0);
  expect(result.cacheWrites).toBe(0);
});

it.each(['qualification', 'evidence'] as const)('preserves same-text drafts with distinct %s after graph export and reruns', async difference => {
  const { services, store } = setup();
  const secondQuote = 'committee chair describes this approach for small collections';
  const units = [
    { ...unit, conditions: [{ type: 'scale', text: 'small collections' }] },
    { ...unit, id: 'u2', conditions: [{ type: 'scale', text: difference === 'qualification' ? 'large collections' : 'small collections' }],
      ...(difference === 'evidence' ? { evidence: [{ excerptId: 'ex1', quote: secondQuote }] } : {}) },
  ];
  const verdicts = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }, { unitId: 'u2', verdict: 'grounded' }] });
  const first = await run({ ...services, llm: new RecordingLlm([payload(units), verdicts]) });
  expect(new Set(first.claimIds).size).toBe(2);
  const persisted = await store.queryNodes({ type: 'Claim' });
  if (!persisted.ok) throw persisted.error;
  expect(persisted.value.items).toHaveLength(2);
  expect(persisted.value.items.map(node => node.metadata?.['conditions'])).toEqual(expect.arrayContaining(units.map(value => value.conditions)));
  expect(persisted.value.items.map(node => node.metadata?.['evidence'])).toEqual(expect.arrayContaining(units.map(value => value.evidence.map(ref => ({ ...ref, quoteVerification: 'exact' })))));
  const renamed = units.map((value, index) => ({ ...value, id: `new${index}` }));
  const config = { ...services.config, llm: { ...services.config.llm, model: 'another-review-model' } };
  const repeated = await run({ ...services, config, llm: new RecordingLlm([payload(renamed), JSON.stringify({ verdicts: [
    { unitId: 'new0', verdict: 'grounded' }, { unitId: 'new1', verdict: 'grounded' },
  ] })]) });
  expect(new Set(repeated.claimIds)).toEqual(new Set(first.claimIds));
  const after = await store.queryNodes({ type: 'Claim' });
  expect(after.ok && after.value.items.length).toBe(2);
});
