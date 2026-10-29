import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SQLiteStore, type GraphStore } from '@aidha/graph-backend';
import { SourceDistillationMiner, composeVector, createIngestionRuntime, readExtractionSnapshot } from '../../src/index.js';
import { GraphPipelineExporter, MemoryCache } from '../../src/pipeline/services.js';
import type { KnowledgeUnit } from '../../src/extract/distill/schema.js';
import { hashSnapshotCandidate, parseSnapshotCandidate, snapshotMatchesInput, snapshotMatchesMiningResult,
  type ExtractionSnapshotCandidate } from '../../src/extract/distill/snapshot.js';
import { buildDistillationOutput } from '../../src/extract/distill/report.js';
import * as segmentedEvidence from '../../src/extract/distill/segmented-evidence.js';
import { RecordingLlm, config, payload, request } from '../extract/distill/fixture.js';

const originalQuote = "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning. Until then, keep the existing eight-unit threshold outside the five trial machines.";
const alert = "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning. Until then, keep the existing eight-unit threshold outside the five trial machines. This is a conditional recommendation by the operations lead, distinct from the supplier's original six-unit proposal. The regulator attended as an observer and gave no endorsement or threshold instruction at the meeting.";
const excerpts = [
  { id: 'a', text: 'In Trial A, the filter removed eighty percent of particles during the first measured hour. The maintenance team logged the reading on the original assembly and checked the sensor twice before closing the run.' },
  { id: 'b', text: 'In Trial B, the filter removed eighty percent of particles during the first measured hour. A different assembly was used for this run, and the technicians checked the sensor twice before closing the trial.' },
  { id: 'later', text: 'The maintenance team stated that the clogging limitation applies only to Trial A and not to Trial B because the original assembly was used there. Dr Vale repeated the team finding in a meeting but did not originate or test the limitation.' },
  { id: 'alert-3', text: alert },
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
  { id: 'u4', kind: 'recommendation', text: 'Maintain the existing eight-unit vibration alert threshold outside the five trial machines, and consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning.', stance: 'recommended', importance: 'core', conditions: [{ type: 'assumption', text: 'nuisance-alert share falls below one in ten for four consecutive weeks after tuning' }, { type: 'exclusion', text: 'outside the five trial machines' }], attribution: { kind: 'third_party', role: 'operations lead' }, evidence: [{ excerptId: 'alert-3', quote: originalQuote }] },
] satisfies KnowledgeUnit[];
const relation = (targetUnitId: string, targetScope: string, quote = 'the clogging limitation applies only to Trial A and not to Trial B') => ({
  limitationUnitId: 'limit', targetUnitId, verdict: 'grounded', relationEvidence: { excerptId: 'later', quote },
  targetScope: { kind: 'trial', text: targetScope }, explanation: 'The later correction restricts the original assembly result.',
});
const vector = composeVector({
  sourceId: 'synthetic', sensitivity: 'public',
  registration: { sourceId: 'synthetic', validateActiveSourceConfig: value => value },
  ingestor: { sourceId: 'synthetic', acquire: () => Promise.resolve({ ok: true as const,
    value: { canonicalId: 'synthetic:combined', sourceType: 'web' as const, label: 'Two filter trials',
      sensitivity: 'public' as const, provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} } }) },
  decode: [{ name: 'synthetic', decode: () => Promise.resolve({ ok: true as const, value: {
    segments: excerpts.map((entry, index) => ({ id: `seg${index}`, text: entry.text,
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })), warnings: [] } }) }],
  context: { build: () => Promise.resolve({}) },
  chunking: { name: 'synthetic', chunk: ({ segments }) => Promise.resolve({ ok: true as const,
    value: excerpts.map((entry, index) => ({ id: entry.id, text: entry.text, segments: segments.slice(index, index + 1),
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })) }) },
});


class CapturingCache extends MemoryCache {
  writes = 0;
  lastWrite: string | undefined;
  constructor(private readonly seed?: string) { super(); }
  override get(key: string) {
    return this.seed === undefined ? super.get(key) : Promise.resolve({ ok: true as const, value: this.seed });
  }
  override set(key: string, value: string) {
    this.writes += 1;
    this.lastWrite = value;
    return super.set(key, value);
  }
}
const expectedSegments = [
  { excerptId: 'alert-3', quote: "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning.", quoteVerification: 'exact' },
  { excerptId: 'alert-3', quote: 'Until then, keep the existing eight-unit threshold outside the five trial machines.', quoteVerification: 'exact' },
];
const replies = (repair: 'grounded' | 'ungrounded' = 'grounded', proposal = units) => [payload(proposal),
  JSON.stringify({ verdicts: proposal.map(unit => ({ unitId: unit.id, verdict: unit.id === 'u4' ? repair : 'grounded' })) }),
  JSON.stringify({ relations: [relation('a', 'Trial A')] })];
const excerptMap = new Map(excerpts.map(entry => [entry.id, entry.text]));
async function mineCombined(options = { enableLimitationApplicability: true, enableSegmentedEvidence: true },
  repair: 'grounded' | 'ungrounded' = 'grounded', proposal = units) {
  const llm = new RecordingLlm(replies(repair, proposal));
  const miner = new SourceDistillationMiner(options);
  const base = request(llm);
  const result = await miner.mine({ ...base, raw: { ...base.raw, canonicalId: 'synthetic:combined' },
    chunks: excerpts.map(entry => ({ id: entry.id, text: entry.text, segments: [],
      locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } })) });
  if (!result.ok) throw result.error;
  const candidate = result.value.extractionSnapshotCandidate;
  if (!candidate) throw new Error('Expected complete combined candidate');
  return { llm, miner, result: result.value, candidate };
}

it.each(['grounded', 'ungrounded'] as const)(
  'retains limitation applicability and complete %s repair through runtime, serialized cache and SQLite reopen', async repair => {
  expect(SQLiteStore.isAvailable()).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), 'aidha-combined-snapshot-'));
  const dbPath = join(directory, 'graph.db');
  let store: SQLiteStore | undefined = SQLiteStore.open(dbPath);
  const llm = new RecordingLlm(replies(repair));
  const cache = new CapturingCache();
  const created = await createIngestionRuntime({ store, llm, cache, config: config(),
    miner: new SourceDistillationMiner({ enableLimitationApplicability: true, enableSegmentedEvidence: true }) });
  if (!created.ok) throw created.error;
  try {
    const result = await created.value.runVector(vector, { ref: 'synthetic:combined' });
    if (!result.ok) throw result.error;
    const snapshot = result.value.extractionSnapshot;
    if (!snapshot) throw new Error('Expected durable combined checkpoint');
    expect(snapshot.limitationApplicability.limitationsByTarget['a']).toMatchObject([
      { id: 'limit', applicability: { trusted: false, targetScope: { kind: 'trial', text: 'Trial A' } } }]);
    expect(snapshot.limitationApplicability.limitationsByTarget['b']).toBeUndefined();
    expect(snapshot.finalUnits.some(unit => unit.id === 'u4')).toBe(repair === 'grounded');
    expect(snapshot.report.segmentRepairs).toEqual(result.value.sourceDistillation?.segmentRepairs);
    expect(snapshot.report.segmentRepairs).toHaveLength(1);
    expect(snapshot.report.segmentRepairs?.[0]).toEqual({ unitId: 'u4',
      status: repair === 'grounded' ? 'grounded' : 'rejected',
      originalUnit: { ...snapshot.proposal.units.find(unit => unit.id === 'u4'),
        evidence: [{ excerptId: 'alert-3', quote: originalQuote, quoteVerification: 'failed' }] },
      replacementEvidence: expectedSegments, finalEvidence: expectedSegments });
    expect(snapshot.report.segmentRepairs?.[0]?.replacementEvidence.map(ref => ref.quote).join(' ')).toBe(originalQuote);
    expect(snapshot.limitationApplicability.affirmativeGroundingIds).toEqual(
      repair === 'grounded' ? ['a', 'b', 'limit', 'u4'] : ['a', 'b', 'limit']);
    expect(llm.requests).toHaveLength(3);
    const serialized = JSON.parse(cache.lastWrite ?? 'null') as { extractionSnapshotCandidate?: unknown } | null;
    expect(serialized?.extractionSnapshotCandidate).toMatchObject({
      limitationApplicability: snapshot.limitationApplicability, report: snapshot.report });
    const repeated = await created.value.runVector(vector, { ref: 'synthetic:combined' });
    if (!repeated.ok) throw repeated.error;
    expect(repeated.value.cacheHits).toBe(1);
    expect(repeated.value.extractionSnapshot).toEqual(snapshot);
    expect(cache.writes).toBe(1);
    expect(llm.requests).toHaveLength(3);
    await created.value.close();
    await store.close(); store = undefined;
    const reopened = SQLiteStore.open(dbPath);
    try {
      const saved = await readExtractionSnapshot(reopened, result.value.resourceId);
      if (!saved.ok) throw saved.error;
      expect(saved.value).toEqual(snapshot);
      const claims = await reopened.queryNodes({ type: 'Claim' });
      if (!claims.ok) throw claims.error;
      const byUnit = new Map(claims.value.items.map(claim => [claim.metadata?.['unitId'], claim]));
      expect(byUnit.get('a')?.metadata?.['limitations']).toEqual(snapshot.limitationApplicability.limitationsByTarget['a']);
      expect(byUnit.get('b')?.metadata?.['limitations']).toBeUndefined();
      if (repair === 'grounded') {
        expect(byUnit.get('u4')?.content).toBe(units[3]?.text);
        expect(byUnit.get('u4')?.metadata).toMatchObject({ trusted: false, evidence: expectedSegments,
          conditions: units[3]?.conditions, attribution: units[3]?.attribution });
      } else {
        expect(byUnit.has('u4')).toBe(false);
        expect(saved.value?.rejectedUnits).toMatchObject([{ reason: 'failed_quote_verification',
          unit: { id: 'u4', evidence: [{ quote: originalQuote, quoteVerification: 'failed' }] } }]);
      }
    } finally { await reopened.close(); }
  } finally {
    await created.value.close();
    await store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps four exact official identities isolated and never runs the default-off splitter', async () => {
  const identities = new Set<string>();
  for (const [limitations, segmentation] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const options = { enableLimitationApplicability: limitations, enableSegmentedEvidence: segmentation };
    const splitter = vi.spyOn(segmentedEvidence, 'prepareSegmentedEvidence');
    try {
      const { miner, candidate, result, llm } = await mineCombined(options);
      expect(splitter).toHaveBeenCalledTimes(segmentation ? 1 : 0);
      splitter.mockClear();
      identities.add(miner.cacheIdentity);
      const identity = JSON.parse(miner.cacheIdentity) as Record<string, unknown>;
      expect(identity['limitation']).toBe(limitations ? 'bounded-limitation-applicability-v1' : null);
      expect(identity['segmentedEvidence']).toBe(segmentation ? 'complete-segmented-evidence-v1' : undefined);
      expect(snapshotMatchesInput(candidate, 'synthetic:combined', miner.cacheIdentity, excerptMap)).toBe(true);
      expect(splitter).toHaveBeenCalledTimes(segmentation ? 1 : 0);
      expect(snapshotMatchesMiningResult(candidate, result)).toBe(true);
      expect(llm.requests).toHaveLength(limitations ? 3 : 2);
      if (!segmentation) {
        const customIdentity = JSON.stringify({ name: 'custom-v1', segmentedEvidence: false });
        expect(candidate.report.segmentRepairs).toBeUndefined();
        expect(snapshotMatchesInput({ ...candidate, minerIdentity: customIdentity },
          'synthetic:combined', customIdentity, excerptMap)).toBe(true);
      }
    } finally { splitter.mockRestore(); }
  }
  expect(identities.size).toBe(4);
  expect(new SourceDistillationMiner().cacheIdentity).toBe(JSON.stringify({
    version: 'bounded-distillation-snapshot-v1', prompt: 'bounded-distill-v1',
    grounding: 'bounded-grounding-v2', limitation: null, intent: 'knowledge_graph', threshold: 0.3 }));
});

it.each(['grounded', 'ungrounded'] as const)(
  'rejects rehashed %s audit mutations while retaining strict nested limitation controls', async repair => {
  const { candidate, miner, result: mined } = await mineCombined(undefined, repair);
  const mutations: [string, (draft: ExtractionSnapshotCandidate) => void][] = [
    ['whole audit omitted', draft => { delete draft.report.segmentRepairs; }],
    ['all audit records deleted', draft => { draft.report.segmentRepairs = []; }],
    ['reversed complete segments', draft => { draft.report.segmentRepairs?.[0]?.replacementEvidence.reverse(); }],
    ['original proposal changed', draft => { const record = draft.report.segmentRepairs?.[0]; if (record) record.originalUnit.text = 'Unsupported proposal'; }],
    ['forged final status', draft => { const record = draft.report.segmentRepairs?.[0]; if (record) record.status = repair === 'grounded' ? 'rejected' : 'grounded'; }],
    ['foreign source', draft => { draft.sourceCanonicalId = 'synthetic:foreign'; }],
    ['duplicate affirmative endpoint', draft => { draft.limitationApplicability.affirmativeGroundingIds.push('a'); }],
    ['missing repaired affirmative endpoint', draft => { if (repair === 'grounded') draft.limitationApplicability.affirmativeGroundingIds = ['a', 'b', 'limit']; else draft.limitationApplicability.affirmativeGroundingIds.push('u4'); }],
    ['foreign segment excerpt', draft => { const evidence = draft.report.segmentRepairs?.[0]?.replacementEvidence[0]; if (evidence) evidence.excerptId = 'foreign'; }],
    ['unknown affirmative endpoint', draft => { draft.limitationApplicability.affirmativeGroundingIds.push('foreign'); }],
    ['missing grounded limitation', draft => { draft.limitationApplicability.affirmativeGroundingIds = ['a', 'b']; }],
    ['wrong target scope', draft => { const summary = draft.limitationApplicability.limitationsByTarget['a']?.[0]; if (summary) summary.applicability.targetScope.text = 'Trial B'; }],
    ['invented relation quote', draft => { const summary = draft.limitationApplicability.limitationsByTarget['a']?.[0]; if (summary) summary.applicability.relationEvidence.quote = 'Unsupported relation statement without source evidence'; }],
  ];
  const directory = await mkdtemp(join(tmpdir(), 'aidha-combined-admission-'));
  const store = SQLiteStore.open(join(directory, 'graph.db'));
  let writes = 0;
  const observedStore = new Proxy(store, { get(target, property, receiver) {
    const value: unknown = Reflect.get(target, property, receiver);
    if (property === 'upsertNode') return (...args: Parameters<GraphStore['upsertNode']>) => {
      writes += 1; return target.upsertNode(...args);
    };
    if (property === 'upsertEdge') return (...args: Parameters<GraphStore['upsertEdge']>) => {
      writes += 1; return target.upsertEdge(...args);
    };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const exporter = new GraphPipelineExporter(observedStore);
  const base = request(new RecordingLlm([]));
  const raw = { ...base.raw, canonicalId: 'synthetic:combined' };
  const chunks = excerpts.map(entry => ({ id: entry.id, text: entry.text, segments: [],
    locator: { kind: 'text' as const, charStart: 0, charEnd: entry.text.length } }));
  try {
    for (const [label, mutate] of mutations) {
      const draft = structuredClone(candidate);
      mutate(draft);
      const parsed = parseSnapshotCandidate(draft);
      const accepted = parsed && snapshotMatchesInput(parsed, 'synthetic:combined', miner.cacheIdentity, excerptMap);
      expect(Boolean(accepted), label).toBe(false);
      expect(parsed, `${label}: intended shape-valid mutation must reach replay`).not.toBeNull();
      if (!parsed) throw new Error(`${label}: expected structurally valid mutation`);
      const output = buildDistillationOutput({ extractionIntent: parsed.extractionIntent,
        sourceType: parsed.proposal.sourceType, sourcePurpose: parsed.proposal.sourcePurpose,
        sourceCoherence: parsed.proposal.sourceCoherence, theses: parsed.proposal.theses,
        units: parsed.finalUnits, rejectedUnits: parsed.rejectedUnits, coverage: parsed.report.coverage,
        diagnostics: parsed.preProjectionDiagnostics, segmentRepairs: parsed.report.segmentRepairs,
        limitationsByTarget: new Map(Object.entries(parsed.limitationApplicability.limitationsByTarget)),
        model: parsed.model, promptVersion: parsed.promptVersion });
      const rehashed = { ...mined, ...output, extractionSnapshotCandidate: parsed,
        extractionSnapshotCandidateHash: hashSnapshotCandidate(parsed),
        distillation: { ...output.distillation, failedClosed: false } };
      // Empty audit arrays are omitted by the report projection; that wire contradiction is rejected too.
      expect(snapshotMatchesMiningResult(parsed, rehashed), label).toBe(label !== 'all audit records deleted');
      expect((await exporter.export(rehashed, raw, chunks)).ok, label).toBe(false);
      expect(writes, label).toBe(0);
    }
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  // These deliberate shape failures are distinct from the rehashed admission controls above.
  const shortEvidence = structuredClone(candidate);
  shortEvidence.report.segmentRepairs?.[0]?.finalEvidence.pop();
  expect(parseSnapshotCandidate(shortEvidence)).toBeNull();
  const provisional = { ...candidate, report: { ...candidate.report,
    segmentRepairs: candidate.report.segmentRepairs?.map(record => ({ ...record, status: 'awaiting_grounding' })) } };
  expect(parseSnapshotCandidate(provisional)).toBeNull();
  for (const value of [null, false, 'future-segmentation']) {
    const minerIdentity = JSON.stringify({ ...(JSON.parse(candidate.minerIdentity) as Record<string, unknown>), segmentedEvidence: value });
    const changed = { ...candidate, minerIdentity };
    expect(snapshotMatchesInput(changed, 'synthetic:combined', minerIdentity, excerptMap)).toBe(false);
  }
  const offIdentity = new SourceDistillationMiner({ enableLimitationApplicability: true }).cacheIdentity;
  expect(snapshotMatchesInput({ ...candidate, minerIdentity: offIdentity }, 'synthetic:combined', offIdentity, excerptMap)).toBe(false);
  const futureIdentity = JSON.stringify({ ...(JSON.parse(candidate.minerIdentity) as Record<string, unknown>), limitation: 'future-limitation' });
  expect(snapshotMatchesInput({ ...candidate, minerIdentity: futureIdentity }, 'synthetic:combined', futureIdentity, excerptMap)).toBe(false);
  for (const minerIdentity of ['custom-v1', JSON.stringify({ name: 'custom-v1', segmentedEvidence: false })]) {
    expect(snapshotMatchesInput({ ...candidate, minerIdentity }, 'synthetic:combined', minerIdentity, excerptMap)).toBe(true);
  }
});

it('treats a rehashed missing rejected audit as a cache miss and freshly regenerates both semantics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-combined-cache-'));
  const store = SQLiteStore.open(join(directory, 'graph.db'));
  const { candidate, result } = await mineCombined(undefined, 'ungrounded');
  const incomplete = { ...candidate, report: { ...candidate.report } };
  delete incomplete.report.segmentRepairs;
  const tampered = JSON.stringify({ ...result, extractionSnapshotCandidate: incomplete,
    extractionSnapshotCandidateHash: hashSnapshotCandidate(incomplete),
    distillation: { ...incomplete.report, failedClosed: false } });
  const llm = new RecordingLlm(replies('ungrounded'));
  const cache = new CapturingCache(tampered);
  const created = await createIngestionRuntime({ store, llm, cache, config: config(),
    miner: new SourceDistillationMiner({ enableLimitationApplicability: true, enableSegmentedEvidence: true }) });
  if (!created.ok) throw created.error;
  try {
    const recovered = await created.value.runVector(vector, { ref: 'synthetic:combined' });
    if (!recovered.ok) throw recovered.error;
    expect(recovered.value.cacheHits).toBe(0);
    expect(llm.requests).toHaveLength(3);
    expect(cache.writes).toBe(1);
    expect(recovered.value.extractionSnapshot?.report.segmentRepairs).toMatchObject([{ unitId: 'u4', status: 'rejected' }]);
    expect(recovered.value.extractionSnapshot?.limitationApplicability.limitationsByTarget['a']).toHaveLength(1);
  } finally { await created.value.close(); await store.close(); await rm(directory, { recursive: true, force: true }); }
});

it('rolls back graph and last-good combined checkpoint when the final Resource write fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-combined-rollback-'));
  const dbPath = join(directory, 'graph.db');
  let store: SQLiteStore | undefined = SQLiteStore.open(dbPath);
  const initial = await createIngestionRuntime({ store, llm: new RecordingLlm(replies()), cache: new MemoryCache(), config: config(),
    miner: new SourceDistillationMiner({ enableLimitationApplicability: true, enableSegmentedEvidence: true }) });
  if (!initial.ok) throw initial.error;
  try {
    const first = await initial.value.runVector(vector, { ref: 'synthetic:combined' });
    if (!first.ok) throw first.error;
    const old = first.value.extractionSnapshot;
    if (!old) throw new Error('Expected first durable checkpoint');
    const before = await store.exportSnapshot({ scope: 'full' });
    if (!before.ok) throw before.error;
    const observed: string[] = [];
    const failedStore = new Proxy(store, { get(target, property, receiver) {
      if (property === 'upsertNode') return async (...args: Parameters<GraphStore['upsertNode']>) => {
        const next = args[2].metadata?.['extractionSnapshot'] as { candidateHash?: string } | undefined;
        if (args[0] === 'Resource' && next?.candidateHash && next.candidateHash !== old.candidateHash) {
          return { ok: false as const, error: new Error('injected combined checkpoint failure') };
        }
        const written = await target.upsertNode(...args);
        if (written.ok && (args[0] === 'Claim' || args[0] === 'Excerpt')) observed.push(args[0]);
        return written;
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const changed = units.map(unit => unit.id === 'a' ? { ...unit, text: 'Trial A recorded a revised eighty-percent observation.' } : unit);
    const cache = new CapturingCache();
    const failed = await createIngestionRuntime({ store: failedStore, llm: new RecordingLlm(replies('grounded', changed)), cache, config: config(),
      miner: new SourceDistillationMiner({ enableLimitationApplicability: true, enableSegmentedEvidence: true }) });
    if (!failed.ok) throw failed.error;
    const result = await failed.value.runVector(vector, { ref: 'synthetic:combined' });
    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: 'injected combined checkpoint failure' }) });
    expect(observed).toEqual(expect.arrayContaining(['Claim', 'Excerpt']));
    expect(cache.writes).toBe(0);
    await initial.value.close(); await failed.value.close();
    await store.close(); store = undefined;
    const reopened = SQLiteStore.open(dbPath);
    try {
      expect(await reopened.exportSnapshot({ scope: 'full' })).toEqual(before);
      const saved = await readExtractionSnapshot(reopened, first.value.resourceId);
      if (!saved.ok) throw saved.error;
      expect(saved.value).toEqual(old);
    } finally { await reopened.close(); }
  } finally { await initial.value.close(); await store?.close(); await rm(directory, { recursive: true, force: true }); }
});

it('rejects a missing or reordered record from an otherwise complete two-unit repair audit', async () => {
  const additional = { ...units[3]!, id: 'u5' };
  const { candidate, miner } = await mineCombined(undefined, 'grounded', [...units, additional]);
  expect(candidate.report.segmentRepairs?.map(record => record.unitId)).toEqual(['u4', 'u5']);
  for (const change of ['missing-one', 'reordered'] as const) {
    const damaged = structuredClone(candidate);
    if (change === 'missing-one') damaged.report.segmentRepairs?.shift();
    else damaged.report.segmentRepairs?.reverse();
    expect(snapshotMatchesInput(damaged, 'synthetic:combined', miner.cacheIdentity, excerptMap), change).toBe(false);
  }
});
