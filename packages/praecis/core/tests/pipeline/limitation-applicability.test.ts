import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteStore } from '@aidha/graph-backend';
import { SourceDistillationMiner, composeVector, createIngestionRuntimeFromServices } from '../../src/index.js';
import { createDefaultPipelineServices, GraphPipelineExporter, MemoryCache } from '../../src/pipeline/services.js';
import { RecordingLlm, config, payload, request } from '../extract/distill/fixture.js';

import type { KnowledgeUnit } from '../../src/extract/distill/schema.js';
import type { SourceLimitationSummary } from '../../src/interfaces/index.js';
import { buildDistillationOutput } from '../../src/extract/distill/report.js';
import { hashSnapshotCandidate, readExtractionSnapshot } from '../../src/extract/distill/snapshot.js';

const excerpts = [
  { id: 'a', text: 'In Trial A, the filter removed eighty percent of particles during the first measured hour. The maintenance team logged the reading on the original assembly and checked the sensor twice before closing the run.' },
  { id: 'b', text: 'In Trial B, the filter removed eighty percent of particles during the first measured hour. A different assembly was used for this run, and the technicians checked the sensor twice before closing the trial.' },
  { id: 'later', text: 'The maintenance team stated that the clogging limitation applies only to Trial A and not to Trial B because the original assembly was used there. Dr Vale repeated the team finding in a meeting but did not originate or test the limitation.' },
] as const;
const units = [
  { id: 'a', kind: 'fact', text: 'Trial A filter removal was measured at eighty percent in the first hour.', stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'a', quote: 'Trial A, the filter removed eighty percent of particles' }] },
  { id: 'b', kind: 'fact', text: 'Trial B filter removal was measured at eighty percent in the first hour.', stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'b', quote: 'Trial B, the filter removed eighty percent of particles' }] },
  { id: 'limit', kind: 'limitation', text: 'The maintenance team identified clogging of the original filter assembly.', stance: 'reported', importance: 'core',
    rationale: 'The original assembly was used in Trial A.', conditions: [{ type: 'scale', text: 'original assembly' }],
    attribution: { kind: 'third_party', role: 'maintenance team' },
    evidence: [{ excerptId: 'later', quote: 'maintenance team stated that the clogging limitation applies only to Trial A' }] },
] satisfies [KnowledgeUnit, KnowledgeUnit, KnowledgeUnit];
const relation = (targetUnitId: string, targetScope: string, quote = 'the clogging limitation applies only to Trial A and not to Trial B') => ({
  limitationUnitId: 'limit', targetUnitId, verdict: 'grounded', relationEvidence: { excerptId: 'later', quote },
  targetScope: { kind: 'trial', text: targetScope }, explanation: 'The later correction restricts the original assembly result.',
});
const vector = composeVector({
  sourceId: 'synthetic', sensitivity: 'public',
  registration: { sourceId: 'synthetic', validateActiveSourceConfig: value => value },
  ingestor: { sourceId: 'synthetic', acquire: () => Promise.resolve({ ok: true as const,
    value: { canonicalId: 'synthetic:limitations', sourceType: 'web' as const, label: 'Two filter trials',
      sensitivity: 'public' as const, provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} } }) },
  decode: [{ name: 'synthetic', decode: () => Promise.resolve({ ok: true as const, value: {
    segments: excerpts.map((entry, index) => ({ id: `seg${index}`, text: entry.text,
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })), warnings: [] } }) }],
  context: { build: () => Promise.resolve({}) },
  chunking: { name: 'synthetic', chunk: ({ segments }) => Promise.resolve({ ok: true as const,
    value: excerpts.map((entry, index) => ({ id: entry.id, text: entry.text, segments: segments.slice(index, index + 1),
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })) }) },
});

const sqliteIt = SQLiteStore.isAvailable() ? it : it.skip;
describe('opt-in limitation applicability through shared runtime and durable Claim storage', () => {
  it('skips the optional relation call when grounded targets project only to supporting or procedure', async () => {
    const projectedUnits = [units[2],
      { ...units[0], kind: 'example' },
      { ...units[1], kind: 'procedure' }];
    const llm = new RecordingLlm([payload(projectedUnits), JSON.stringify({ verdicts:
      projectedUnits.map(unit => ({ unitId: unit.id, verdict: 'grounded' })) })]);
    const input = request(llm);
    const result = await new SourceDistillationMiner({ enableLimitationApplicability: true }).mine({ ...input,
      chunks: excerpts.map(entry => ({ id: entry.id, text: entry.text, segments: [],
        locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })) });
    if (!result.ok) throw result.error;
    expect(llm.requests).toHaveLength(2);
    expect(result.value.claims).toHaveLength(1);
    expect(result.value.claims[0]?.metadata?.['unitId']).toBe('limit');
  });

  it.each([
    { invalidUsage: -1, maxTokens: 10_000 },
    { invalidUsage: Number.NaN, maxTokens: undefined },
  ])('fails closed when the optional call reports invalid usage $invalidUsage', async ({ invalidUsage, maxTokens }) => {
    const llm = new RecordingLlm([
      payload(units),
      JSON.stringify({ verdicts: units.map(unit => ({ unitId: unit.id, verdict: 'grounded' })) }),
      { ok: true, value: JSON.stringify({ relations: [relation('a', 'Trial A')] }),
        usage: { inputTokens: invalidUsage, outputTokens: 0, totalTokens: invalidUsage } },
    ]);
    const input = request(llm);
    const result = await new SourceDistillationMiner({ enableLimitationApplicability: true }).mine({ ...input,
      chunks: excerpts.map(entry => ({ id: entry.id, text: entry.text, segments: [],
        locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })),
      costCeiling: maxTokens === undefined ? {} : { maxTokens } });
    if (!result.ok) throw result.error;
    expect(llm.requests).toHaveLength(3);
    expect(result.value.claims).toHaveLength(0);
    expect(result.value.distillation?.failedClosed).toBe(true);
    expect(result.value.distillation?.diagnostics).toEqual([expect.stringContaining('invalid token usage')]);
  });

  it('keeps standalone claims when the remaining token ceiling cannot cover the optional call', async () => {
    const completion = (value: string, totalTokens: number) => ({ ok: true as const, value,
      usage: { inputTokens: totalTokens - 50, outputTokens: 50, totalTokens } });
    const llm = new RecordingLlm([
      completion(payload(units), 1000),
      completion(JSON.stringify({ verdicts: units.map(unit => ({ unitId: unit.id, verdict: 'grounded' })) }), 2800),
    ]);
    const input = request(llm);
    const result = await new SourceDistillationMiner({ enableLimitationApplicability: true }).mine({ ...input,
      chunks: excerpts.map(entry => ({ id: entry.id, text: entry.text, segments: [],
        locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })),
      costCeiling: { maxTokens: 4000 } });
    if (!result.ok) throw result.error;
    expect(llm.requests).toHaveLength(2);
    expect(result.value.claims).toHaveLength(3);
    expect(result.value.claims.every(claim => claim.metadata?.['limitations'] === undefined)).toBe(true);
    expect(result.value.distillation?.diagnostics.some(message => message.includes('links skipped'))).toBe(true);
  });

  sqliteIt.each([
    { label: 'optional transport failure', responses: [payload(units),
      JSON.stringify({ verdicts: units.map(value => ({ unitId: value.id, verdict: 'grounded' })) }),
      new Error('synthetic relation transport failure')], calls: 3 },
    { label: 'optional parse failure', responses: [payload(units),
      JSON.stringify({ verdicts: units.map(value => ({ unitId: value.id, verdict: 'grounded' })) }),
      'not relation JSON'], calls: 3 },
    { label: 'grounding transport failure', responses: [payload(units), new Error('synthetic grounding failure')], calls: 2 },
    { label: 'duplicate grounding verdict', responses: [payload(units),
      JSON.stringify({ verdicts: [...units.map(value => ({ unitId: value.id, verdict: 'grounded' })),
        { unitId: 'limit', verdict: 'grounded' }] })], calls: 2 },
    { label: 'nonliteral relation quote', responses: [payload(units),
      JSON.stringify({ verdicts: units.map(value => ({ unitId: value.id, verdict: 'grounded' })) }),
      JSON.stringify({ relations: [relation('a', 'Trial A', 'an invented sentence with no source match')] })], calls: 3 },
    { label: 'missing affirmative grounding', responses: [payload(units),
      JSON.stringify({ verdicts: units.filter(value => value.id !== 'limit').map(value => ({ unitId: value.id, verdict: 'grounded' })) })], calls: 2 },
    { label: 'a malformed contradictory proposal beside a valid link', responses: [payload(units),
      JSON.stringify({ verdicts: units.map(value => ({ unitId: value.id, verdict: 'grounded' })) }),
      JSON.stringify({ relations: [relation('a', 'Trial A'),
        { ...relation('a', 'Trial A'), verdict: 'unsupported', relationEvidence: null }] })], calls: 3 },
  ])('retains standalone assertions but no link for $label', async ({ responses, calls }) => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-negative-'));
    let store: SQLiteStore | undefined;
    try {
      store = SQLiteStore.open(join(directory, 'graph.db'));
      const llm = new RecordingLlm(responses);
      const services = createDefaultPipelineServices({ store, llm,
        miner: new SourceDistillationMiner({ enableLimitationApplicability: true }), config: config() });
      const result = await createIngestionRuntimeFromServices(services).runVector(vector, { ref: 'synthetic:limitations' });
      if (!result.ok) throw result.error;
      expect(llm.requests).toHaveLength(calls);
      await store.close(); store = undefined;
      store = SQLiteStore.open(join(directory, 'graph.db'));
      const nodes = await store.queryNodes({ type: 'Claim' });
      if (!nodes.ok) throw nodes.error;
      expect(nodes.value.items).toHaveLength(3);
      expect(nodes.value.items.every(node => node.metadata?.['limitations'] === undefined)).toBe(true);
      expect(nodes.value.items.some(node => node.metadata?.['unitId'] === 'limit')).toBe(true);
    } finally {
      await store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  sqliteIt('keeps qualified claims distinct when only limitation meaning changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-identity-'));
    const dbPath = join(directory, 'graph.db');
    let store: SQLiteStore | undefined;
    try {
      store = SQLiteStore.open(dbPath);
      const exporter = new GraphPipelineExporter(store);
      const raw = { canonicalId: 'synthetic:identity', label: 'Qualification identity fixture', sourceType: 'web' as const,
        sensitivity: 'public' as const, provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} };
      const chunks = [{ id: 'a', text: excerpts[0].text, segments: [],
        locator: { kind: 'text' as const, charStart: 0, charEnd: excerpts[0].text.length } }];
      const common = { text: 'Trial A filter removal was measured at eighty percent in the first hour.',
        excerptIds: ['a'], state: 'draft' as const,
        metadata: { method: 'llm-distill', unitKind: 'fact', stance: 'asserted',
          evidence: [{ excerptId: 'a', quote: 'Trial A, the filter removed eighty percent of particles' }] } };
      const limitation = { id: 'limit', text: 'The maintenance team identified clogging of the original filter assembly.',
        stance: 'reported', evidence: [{ excerptId: 'later', quote: 'maintenance team stated that the clogging limitation applies only to Trial A', quoteVerification: 'exact' }],
        attribution: { kind: 'third_party', role: 'maintenance team' },
        applicability: { trusted: false, targetScope: { kind: 'trial', text: 'Trial A' },
          relationEvidence: { excerptId: 'later', quote: 'the clogging limitation applies only to Trial A and not to Trial B', quoteVerification: 'exact' } } };
      const first = await exporter.export({ claims: [{ ...common, metadata: { ...common.metadata, limitations: [limitation] } }] }, raw, chunks);
      if (!first.ok) throw first.error;
      const second = await exporter.export({ claims: [{ ...common, metadata: { ...common.metadata,
        limitations: [{ ...limitation, text: 'The maintenance team identified a calibration limitation of the original filter assembly.' }] } }] }, raw, chunks);
      if (!second.ok) throw second.error;
      expect(second.value.claimIds[0]).not.toBe(first.value.claimIds[0]);
      const third = await exporter.export({ claims: [{ ...common, metadata: { ...common.metadata,
        limitations: [{ ...limitation, id: 'renumbered-unit',
          evidence: [{ excerptId: 'later', quote: 'clogging limitation applies only to Trial A', quoteVerification: 'exact' }],
          applicability: { ...limitation.applicability,
            relationEvidence: { excerptId: 'later', quote: 'clogging limitation applies only to Trial A', quoteVerification: 'exact' } } }] } }] }, raw, chunks);
      if (!third.ok) throw third.error;
      expect(third.value.claimIds[0]).not.toBe(first.value.claimIds[0]);
      const renumbered = await exporter.export({ claims: [{ ...common, metadata: { ...common.metadata,
        limitations: [{ ...limitation, id: 'another-unit-id' }] } }] }, raw, chunks);
      if (!renumbered.ok) throw renumbered.error;
      expect(renumbered.value.claimIds[0]).toBe(first.value.claimIds[0]);
      await store.close(); store = undefined;
      store = SQLiteStore.open(dbPath);
      const nodes = await store.queryNodes({ type: 'Claim' });
      if (!nodes.ok) throw nodes.error;
      expect(nodes.value.items).toHaveLength(3);
    } finally {
      await store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  sqliteIt('attaches the later A-only limitation to A and retains B and the standalone limitation after reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-'));
    const dbPath = join(directory, 'graph.db');
    let store: SQLiteStore | undefined;
    try {
      store = SQLiteStore.open(dbPath);
      const llm = new RecordingLlm([
        payload(units), JSON.stringify({ verdicts: units.map(value => ({ unitId: value.id, verdict: 'grounded' })) }),
        JSON.stringify({ relations: [relation('a', 'Trial A'), { ...relation('b', 'Trial B'), verdict: 'unsupported' }] }),
      ]);
      const miner = new SourceDistillationMiner({ enableLimitationApplicability: true });
      const services = createDefaultPipelineServices({ store, llm, miner, config: config() });
      const result = await createIngestionRuntimeFromServices(services).runVector(vector, { ref: 'synthetic:limitations' });
      if (!result.ok) throw result.error;
      expect(result.value.claimsExtracted).toBe(3);
      expect(llm.requests).toHaveLength(3);
      expect(llm.requests[2]?.user).toContain('not to Trial B');
      expect(llm.requests[2]?.user).toContain('Trial A, the filter removed eighty percent');
      expect(llm.requests[2]?.user).toContain('Trial B, the filter removed eighty percent');
      await store.close(); store = undefined;
      store = SQLiteStore.open(dbPath);
      const nodes = await store.queryNodes({ type: 'Claim' });
      if (!nodes.ok) throw nodes.error;
      expect(nodes.value.items).toHaveLength(3);
      const byUnit = new Map(nodes.value.items.map(node => [node.metadata?.['unitId'], node]));
      expect(byUnit.get('a')?.metadata?.['limitations']).toMatchObject([{ id: 'limit', text: units[2].text,
        attribution: { kind: 'third_party', role: 'maintenance team' },
        evidence: [{ excerptId: 'later', quoteVerification: 'exact' }],
        applicability: { trusted: false, targetScope: { kind: 'trial', text: 'Trial A' },
          relationEvidence: { excerptId: 'later', quoteVerification: 'exact' } } }]);
      expect(byUnit.get('a')?.metadata?.['conditions']).toBeUndefined();
      expect(byUnit.get('b')?.metadata?.['limitations']).toBeUndefined();
      expect(byUnit.get('limit')?.metadata?.['evidence']).toMatchObject([{ excerptId: 'later', quoteVerification: 'exact' }]);
      expect(byUnit.get('limit')?.metadata?.['attribution']).toEqual({ kind: 'third_party', role: 'maintenance team' });
    } finally {
      await store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class JsonRecordingCache extends MemoryCache {
  saved: string | undefined;
  override set(key: string, value: string) { this.saved = value; return super.set(key, value); }
}
const groundedUnits = JSON.stringify({ verdicts: units.map(unit => ({ unitId: unit.id, verdict: 'grounded' })) });
const replies = (): [string, string, string] => [payload(units), groundedUnits, JSON.stringify({ relations: [relation('a', 'Trial A')] })];

sqliteIt('preserves the explicit limitation map through runtime, JSON cache replay and SQLite reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-checkpoint-'));
  const dbPath = join(directory, 'graph.db');
  let store = SQLiteStore.open(dbPath);
  try {
    const cache = new JsonRecordingCache();
    const llm = new RecordingLlm(replies());
    const miner = new SourceDistillationMiner({ enableLimitationApplicability: true });
    const run = () => createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, llm, miner, cache, config: config() }))
      .runVector(vector, { ref: 'synthetic:limitations' });
    const fresh = await run();
    if (!fresh.ok) throw fresh.error;
    expect(llm.requests).toHaveLength(3);
    const snapshot = fresh.value.extractionSnapshot;
    const proposed = relation('a', 'Trial A');
    const { kind: _kind, importance: _importance, ...expectedLimitation } = units[2];
    const expectedMap = { a: [{ ...expectedLimitation, evidence: units[2].evidence.map(ref => ({ ...ref, quoteVerification: 'exact' })),
      applicability: { trusted: false, targetScope: proposed.targetScope, explanation: proposed.explanation,
        relationEvidence: { ...proposed.relationEvidence, quoteVerification: 'exact' } } }] };
    expect(snapshot?.limitationApplicability).toEqual({ affirmativeGroundingIds: ['a', 'b', 'limit'], limitationsByTarget: expectedMap });
    expect(cache.saved).toBeDefined();
    expect(JSON.parse(cache.saved!).extractionSnapshotCandidate.limitationApplicability)
      .toEqual(snapshot?.limitationApplicability);
    await store.close();
    store = SQLiteStore.open(dbPath);
    const noCalls = new RecordingLlm([new Error('Cache replay must not call the model')]);
    const hit = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, llm: noCalls, miner, cache, config: config() }))
      .runVector(vector, { ref: 'synthetic:limitations' });
    if (!hit.ok) throw hit.error;
    expect(hit.value.cacheHits).toBe(1);
    expect(noCalls.requests).toHaveLength(0);
    expect(hit.value.extractionSnapshot).toEqual(snapshot);
    await store.close();
    store = SQLiteStore.open(dbPath);
    const persisted = await readExtractionSnapshot(store, snapshot!.resourceId);
    if (!persisted.ok) throw persisted.error;
    expect(persisted.value).toEqual(snapshot);
    const claims = await store.queryNodes({ type: 'Claim' });
    if (!claims.ok) throw claims.error;
    const byUnit = new Map(claims.value.items.map(node => [node.metadata?.['unitId'], node]));
    expect(byUnit.get('a')?.metadata?.['limitations']).toEqual(snapshot?.limitationApplicability.limitationsByTarget['a']);
    expect(byUnit.get('b')?.metadata?.['limitations']).toBeUndefined();
    expect(byUnit.has('limit')).toBe(true);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});


sqliteIt.each([true, false])('isolates enabled and disabled limitation caches (enabled first=%s)', async firstEnabled => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-modes-'));
  const store = SQLiteStore.open(join(directory, 'graph.db'));
  try {
    const cache = new JsonRecordingCache();
    const identities: string[] = [];
    for (const enabled of [firstEnabled, !firstEnabled]) {
      const miner = new SourceDistillationMiner({ enableLimitationApplicability: enabled });
      identities.push(miner.cacheIdentity);
      const llm = new RecordingLlm(enabled ? replies() : replies().slice(0, 2));
      const runtime = createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, llm, miner, cache, config: config() }));
      const fresh = await runtime.runVector(vector, { ref: 'synthetic:limitations' });
      if (!fresh.ok) throw fresh.error;
      expect(fresh.value.cacheHits).toBe(0);
      expect(llm.requests).toHaveLength(enabled ? 3 : 2);
      expect(Object.keys(fresh.value.extractionSnapshot!.limitationApplicability.limitationsByTarget)).toEqual(enabled ? ['a'] : []);
      const hit = await runtime.runVector(vector, { ref: 'synthetic:limitations' });
      if (!hit.ok) throw hit.error;
      expect(hit.value.cacheHits).toBe(1);
      expect(llm.requests).toHaveLength(enabled ? 3 : 2);
      expect(hit.value.extractionSnapshot).toEqual(fresh.value.extractionSnapshot);
    }
    expect(identities[0]).not.toBe(identities[1]);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

const mapDamage = [
  'missing-map', 'wrong-target', 'unknown-endpoint', 'no-affirmative', 'summary-meaning',
  'summary-attribution', 'summary-evidence', 'relation-quote', 'target-scope', 'duplicate-pair', 'disabled-identity', 'unknown-summary-field',
] as const;

sqliteIt.each(mapDamage)('rejects %s map damage even with recomputed hash and reprojected sibling claims', async damage => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-tamper-'));
  const store = SQLiteStore.open(join(directory, 'graph.db'));
  try {
    const miner = new SourceDistillationMiner({ enableLimitationApplicability: true });
    const cache = new JsonRecordingCache();
    const good = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, miner, cache,
      llm: new RecordingLlm(replies()), config: config() })).runVector(vector, { ref: 'synthetic:limitations' });
    if (!good.ok) throw good.error;
    const damaged = JSON.parse(cache.saved!);
    const candidate = damaged.extractionSnapshotCandidate;
    const application = candidate.limitationApplicability;
    const map = application.limitationsByTarget;
    const summary = map.a[0];
    switch (damage) {
      case 'disabled-identity': candidate.minerIdentity = new SourceDistillationMiner().cacheIdentity; break;
      case 'unknown-summary-field': summary.extra = 'unrecognised'; break;
      case 'missing-map': delete application.limitationsByTarget; break;
      case 'wrong-target': map.b = map.a; delete map.a; break;
      case 'unknown-endpoint': summary.id = 'absent'; break;
      case 'no-affirmative': application.affirmativeGroundingIds = ['a', 'b']; break;
      case 'summary-meaning': summary.text = 'Invented limitation meaning'; break;
      case 'summary-attribution': summary.attribution = { kind: 'third_party', name: 'Dr Vale' }; break;
      case 'summary-evidence': summary.evidence[0].quote = 'invented limitation quote'; break;
      case 'relation-quote': summary.applicability.relationEvidence.quote = 'invented Trial A relation'; break;
      case 'target-scope': summary.applicability.targetScope.text = 'Trial B'; break;
      case 'duplicate-pair': map.a.push(structuredClone(summary)); break;
    }
    const output = buildDistillationOutput({ extractionIntent: candidate.extractionIntent,
      sourceType: candidate.proposal.sourceType, sourcePurpose: candidate.proposal.sourcePurpose,
      sourceCoherence: candidate.proposal.sourceCoherence, theses: candidate.proposal.theses,
      units: candidate.finalUnits, rejectedUnits: candidate.rejectedUnits,
      limitationsByTarget: new Map(Object.entries((application.limitationsByTarget ?? {}) as Record<string, SourceLimitationSummary[]>)),
      coverage: candidate.report.coverage, diagnostics: candidate.preProjectionDiagnostics,
      model: candidate.model, promptVersion: candidate.promptVersion });
    Object.assign(damaged, output, { distillation: { ...output.distillation, failedClosed: false } });
    damaged.extractionSnapshotCandidateHash = hashSnapshotCandidate(candidate);
    const wire = JSON.stringify(damaged);
    const seededCache = new MemoryCache();
    seededCache.get = async () => ({ ok: true, value: wire });
    const freshLlm = new RecordingLlm(replies());
    const replay = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, miner, cache: seededCache,
      llm: freshLlm, config: config() })).runVector(vector, { ref: 'synthetic:limitations' });
    if (!replay.ok) throw replay.error;
    expect(replay.value.cacheHits).toBe(0);
    expect(freshLlm.requests).toHaveLength(3);
    expect(replay.value.extractionSnapshot).toEqual(good.value.extractionSnapshot);
    const graphBefore = await store.exportSnapshot({ scope: 'full' });
    if (!graphBefore.ok) throw graphBefore.error;
    const delegated = { extractionSnapshotVersion: 1 as const, cacheIdentity: candidate.minerIdentity,
      mine: async () => ({ ok: true as const, value: damaged }) };
    const rejected = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, miner: delegated,
      cache: new MemoryCache(), llm: new RecordingLlm([]), config: config() })).runVector(vector, { ref: 'synthetic:limitations' });
    expect(rejected.ok).toBe(false);
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(graphBefore);
    if (!rejected.ok) expect(rejected.error.message).toContain('no complete matching extraction snapshot');
    const persisted = await readExtractionSnapshot(store, good.value.extractionSnapshot!.resourceId);
    if (!persisted.ok) throw persisted.error;
    expect(persisted.value).toEqual(good.value.extractionSnapshot);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

sqliteIt('preserves the previous checkpoint and avoids cache writes on invalid optional-call usage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-failed-'));
  const store = SQLiteStore.open(join(directory, 'graph.db'));
  try {
    const miner = new SourceDistillationMiner({ enableLimitationApplicability: true });
    const good = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, miner,
      llm: new RecordingLlm(replies()), config: config() })).runVector(vector, { ref: 'synthetic:limitations' });
    if (!good.ok) throw good.error;
    const graphBefore = await store.exportSnapshot({ scope: 'full' });
    if (!graphBefore.ok) throw graphBefore.error;
    const failedCache = new JsonRecordingCache();
    const llm = new RecordingLlm([payload(units), groundedUnits,
      { ok: true, value: replies()[2], usage: { inputTokens: -1, outputTokens: 0, totalTokens: -1 } }]);
    const failed = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, miner, cache: failedCache,
      llm, config: config() })).runVector(vector, { ref: 'synthetic:limitations' });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toContain('invalid token usage');
    expect(llm.requests).toHaveLength(3);
    expect(failedCache.saved).toBeUndefined();
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(graphBefore);
    const persisted = await readExtractionSnapshot(store, good.value.extractionSnapshot!.resourceId);
    if (!persisted.ok) throw persisted.error;
    expect(persisted.value).toEqual(good.value.extractionSnapshot);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});


sqliteIt('skips the entire optional set for an extra unsupported relation field and commits a standalone empty-map checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-limitation-protocol-'));
  const dbPath = join(directory, 'graph.db');
  let store = SQLiteStore.open(dbPath);
  try {
    const llm = new RecordingLlm([payload(units), groundedUnits, JSON.stringify({ relations: [
      relation('a', 'Trial A'), { ...relation('b', 'Trial B'), unsupported: 'protocol drift' },
    ] })]);
    const miner = new SourceDistillationMiner({ enableLimitationApplicability: true });
    const cache = new JsonRecordingCache();
    const result = await createIngestionRuntimeFromServices(createDefaultPipelineServices({ store, miner, cache, llm, config: config() }))
      .runVector(vector, { ref: 'synthetic:limitations' });
    if (!result.ok) throw result.error;
    expect(llm.requests).toHaveLength(3);
    expect(result.value.claimsExtracted).toBe(3);
    const snapshot = result.value.extractionSnapshot!;
    expect(snapshot.limitationApplicability).toEqual({ affirmativeGroundingIds: ['a', 'b', 'limit'], limitationsByTarget: {} });
    expect(snapshot.report.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('Limitation applicability parse failure (links skipped)'),
    ]));
    expect(JSON.parse(cache.saved!).extractionSnapshotCandidate.limitationApplicability).toEqual(snapshot.limitationApplicability);
    await store.close();
    store = SQLiteStore.open(dbPath);
    const saved = await readExtractionSnapshot(store, snapshot.resourceId);
    if (!saved.ok) throw saved.error;
    expect(saved.value).toEqual(snapshot);
    const claims = await store.queryNodes({ type: 'Claim' });
    if (!claims.ok) throw claims.error;
    expect(claims.value.items).toHaveLength(3);
    expect(claims.value.items.every(claim => claim.metadata?.['limitations'] === undefined)).toBe(true);
    expect(claims.value.items.map(claim => claim.metadata?.['unitId']).sort()).toEqual(['a', 'b', 'limit']);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
