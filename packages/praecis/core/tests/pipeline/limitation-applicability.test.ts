import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteStore } from '@aidha/graph-backend';
import { SourceDistillationMiner, composeVector, createIngestionRuntimeFromServices } from '../../src/index.js';
import { createDefaultPipelineServices, GraphPipelineExporter } from '../../src/pipeline/services.js';
import { RecordingLlm, config, payload, request } from '../extract/distill/fixture.js';

const excerpts = [
  { id: 'a', text: 'In Trial A, the filter removed eighty percent of particles during the first measured hour. The maintenance team logged the reading on the original assembly and checked the sensor twice before closing the run.' },
  { id: 'b', text: 'In Trial B, the filter removed eighty percent of particles during the first measured hour. A different assembly was used for this run, and the technicians checked the sensor twice before closing the trial.' },
  { id: 'later', text: 'The maintenance team stated that the clogging limitation applies only to Trial A and not to Trial B because the original assembly was used there. Dr Vale repeated the team finding in a meeting but did not originate or test the limitation.' },
];
const units = [
  { id: 'a', kind: 'fact', text: 'Trial A filter removal was measured at eighty percent in the first hour.', stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'a', quote: 'Trial A, the filter removed eighty percent of particles' }] },
  { id: 'b', kind: 'fact', text: 'Trial B filter removal was measured at eighty percent in the first hour.', stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'b', quote: 'Trial B, the filter removed eighty percent of particles' }] },
  { id: 'limit', kind: 'limitation', text: 'The maintenance team identified clogging of the original filter assembly.', stance: 'reported', importance: 'core',
    rationale: 'The original assembly was used in Trial A.', conditions: [{ type: 'scale', text: 'original assembly' }],
    attribution: { kind: 'third_party', role: 'maintenance team' },
    evidence: [{ excerptId: 'later', quote: 'maintenance team stated that the clogging limitation applies only to Trial A' }] },
];
const relation = (targetUnitId: string, targetScope: string, quote = 'the clogging limitation applies only to Trial A and not to Trial B') => ({
  limitationUnitId: 'limit', targetUnitId, verdict: 'grounded', relationEvidence: { excerptId: 'later', quote },
  targetScope: { kind: 'trial', text: targetScope }, explanation: 'The later correction restricts the original assembly result.',
});
const vector = composeVector({
  sourceId: 'synthetic', sensitivity: 'public',
  registration: { sourceId: 'synthetic', validateActiveSourceConfig: value => value },
  ingestor: { sourceId: 'synthetic', acquire: async () => ({ ok: true as const,
    value: { canonicalId: 'synthetic:limitations', sourceType: 'web' as const, label: 'Two filter trials',
      sensitivity: 'public' as const, provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} } }) },
  decode: [{ name: 'synthetic', decode: async () => ({ ok: true as const, value: {
    segments: excerpts.map((entry, index) => ({ id: `seg${index}`, text: entry.text,
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })), warnings: [] } }) }],
  context: { build: async () => ({}) },
  chunking: { name: 'synthetic', chunk: async ({ segments }) => ({ ok: true as const,
    value: excerpts.map((entry, index) => ({ id: entry.id, text: entry.text, segments: [segments[index]],
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })) }) },
});

const sqliteIt = SQLiteStore.isAvailable() ? it : it.skip;
describe('opt-in limitation applicability through shared runtime and durable Claim storage', () => {
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
      const raw = { canonicalId: 'synthetic:identity', sourceType: 'web' as const,
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
