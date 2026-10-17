import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore, type GraphStore, type Result } from '@aidha/graph-backend';
import { SourceDistillationMiner, composeVector, createIngestionRuntime, type ICandidateMiner, type MiningResult,
  readExtractionSnapshot, SourceDistillationClosedError } from '../../src/index.js';
import { MemoryCache } from '../../src/pipeline/services.js';
import { hashSnapshotCandidate, parseSnapshotCandidate, snapshotMatchesMiningResult } from '../../src/extract/distill/snapshot.js';
import { buildDistillationOutput } from '../../src/extract/distill/report.js';
import { createRawSource } from '../../src/compose/source-envelope.js';
import { RecordingLlm, config, grounded, payload, request, source, unit } from '../extract/distill/fixture.js';

const tempPaths: string[] = [];
afterEach(() => { for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true }); });

class CapturingCache extends MemoryCache {
  lastWrite: string | undefined;
  writes = 0;
  constructor(private readonly seeded?: string) { super(); }
  override get(key: string) {
    return this.seeded === undefined ? super.get(key) : Promise.resolve({ ok: true as const, value: this.seeded });
  }
  override set(key: string, value: string) {
    this.writes += 1;
    this.lastWrite = value;
    return super.set(key, value);
  }
}

const makeVector = (canonicalId = 'synthetic:checkpoint', dedupKeys: string[] = [],
  resourceMetadata: Record<string, unknown> = { ownerNote: 'retain me' }, sourceText = source) => composeVector({
  sourceId: 'snapshot-test', sensitivity: 'public',
  registration: { sourceId: 'snapshot-test', validateActiveSourceConfig: value => value },
  ingestor: { sourceId: 'snapshot-test', acquire: async () => ({ ok: true as const, value: {
    canonicalId, dedupKeys, sourceType: 'web', sensitivity: 'public' as const,
    provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' },
    resourceMetadata, label: 'Fictional checkpoint source', payload: {},
  } }) },
  decode: [{ name: 'synthetic', decode: async () => ({ ok: true as const, value: {
    segments: [{ id: 'seg1', text: sourceText, locator: { kind: 'text' as const, charStart: 0, charEnd: sourceText.length } }], warnings: [],
  } }) }],
  context: { build: async () => ({}) },
  chunking: { name: 'synthetic-chunks', chunk: async ({ segments }) => ({ ok: true as const, value: [
    { id: 'ex1', segments, text: sourceText, locator: { kind: 'text' as const, charStart: 0, charEnd: sourceText.length } },
  ] }) },
});

it('hashes a valid nested candidate identically under different locale collations', async () => {
  const mined = await new SourceDistillationMiner().mine(request(new RecordingLlm([payload(), grounded])));
  if (!mined.ok) throw mined.error;
  const original = mined.value.extractionSnapshotCandidate;
  if (!original) throw new Error('Expected a valid snapshot candidate');
  const candidate = parseSnapshotCandidate({ ...original, report: { ...original.report,
    localeProbe: { z: 1, t: 2, 'ä': 3 } } });
  if (!candidate) throw new Error('Expected the nested report extension to validate');
  let locale: 'en' | 'et' = 'en';
  const collators = { en: new Intl.Collator('en'), et: new Intl.Collator('et') };
  expect(['z', 't', 'ä'].sort(collators.en.compare)).not.toEqual(['z', 't', 'ä'].sort(collators.et.compare));
  const spy = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (this: string, other: string) {
    return collators[locale].compare(this, other);
  });
  try {
    const first = hashSnapshotCandidate(candidate);
    locale = 'et';
    expect(hashSnapshotCandidate(candidate)).toBe(first);
  } finally {
    spy.mockRestore();
  }
});

it('commits a versioned complete extraction snapshot through configured runtime and SQLite reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-extraction-snapshot-'));
  tempPaths.push(dir);
  const dbPath = join(dir, 'graph.sqlite');
  const store = SQLiteStore.open(dbPath);
  const example = { ...unit, id: 'u2', kind: 'example', importance: 'supporting',
    text: 'The committee chair uses linked index files for a small collection.', supportsUnitIds: ['u1'] };
  const incidental = { ...unit, id: 'u3', kind: 'fact', importance: 'incidental',
    text: 'The chair records several further observations in the source.' };
  const rejected = { ...unit, id: 'u4', text: 'This asserted mechanism has no support in the source.',
    evidence: [{ excerptId: 'ex1', quote: 'these words do not occur in the source excerpt' }] };
  const proposalUnits = [
    { ...unit, rationale: 'The source states the mechanism.', conditions: [{ type: 'scale', text: 'small collections' }] },
    example, incidental, rejected,
  ];
  const llm = new RecordingLlm([payload(proposalUnits), JSON.stringify({ verdicts: [
    { unitId: 'u1', verdict: 'grounded' }, { unitId: 'u2', verdict: 'grounded' },
    { unitId: 'u3', verdict: 'grounded' },
  ] })]);
  const created = await createIngestionRuntime({ store, llm, miner: new SourceDistillationMiner({ quoteFailureCloseThreshold: 1 }),
    cache: new MemoryCache(), config: config() });
  if (!created.ok) throw created.error;
  const result = await created.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
  if (!result.ok) throw result.error;
  expect(result.value.claimsExtracted).toBe(1);
  await created.value.close();
  await store.close();

  const reopened = SQLiteStore.open(dbPath);
  try {
    const resource = await reopened.getNode(result.value.resourceId);
    if (!resource.ok) throw resource.error;
    const snapshot = resource.value?.metadata?.['extractionSnapshot'] as Record<string, unknown> | undefined;
    expect(snapshot).toMatchObject({ schemaVersion: 1, trusted: false, sourceCanonicalId: 'synthetic:checkpoint',
      resourceId: result.value.resourceId, claimIds: result.value.claimIds, excerptIds: result.value.excerptIds,
      proposal: { units: expect.arrayContaining([expect.objectContaining({ id: 'u3' }), expect.objectContaining({ id: 'u4' })]) },
      finalUnits: expect.arrayContaining([expect.objectContaining({ id: 'u1',
        conditions: [{ type: 'scale', text: 'small collections' }],
        evidence: [{ excerptId: 'ex1', quote: 'reads index files and follows explicit links', quoteVerification: 'exact' }],
      })]),
      rejectedUnits: expect.arrayContaining([expect.objectContaining({ unit: expect.objectContaining({ id: 'u4' }),
        reason: 'failed_quote_verification' })]),
      supportingUnits: expect.arrayContaining([expect.objectContaining({ id: 'u2', supportsUnitIds: ['u1'] })]),
    });
    expect(snapshot?.['proposal']).toEqual(JSON.parse(payload(proposalUnits)));
    expect((snapshot?.['finalUnits'] as unknown[])).toHaveLength(3);
    expect((snapshot?.['rejectedUnits'] as unknown[])).toHaveLength(1);
    expect(snapshot).toEqual(result.value.extractionSnapshot);
    expect(resource.value?.metadata?.['ownerNote']).toBe('retain me');
    const read = await readExtractionSnapshot(reopened, result.value.resourceId);
    if (!read.ok) throw read.error;
    expect(read.value).toEqual(snapshot);
    const report = snapshot?.['report'] as Record<string, unknown>;
    expect(parseSnapshotCandidate({ ...snapshot, report: { ...report, futureAudit: { score: Number.NaN } } })).toBeNull();
    expect(parseSnapshotCandidate({ ...snapshot, report: { ...report, futureAudit: () => 'unsafe' } })).toBeNull();
    expect(parseSnapshotCandidate({ ...snapshot, report: { ...report, futureAudit: undefined } })).not.toBeNull();
    const claim = await reopened.getNode(result.value.claimIds[0] ?? 'missing');
    if (!claim.ok) throw claim.error;
    expect(claim.value).toMatchObject({ type: 'Claim', content: proposalUnits[0]?.text,
      metadata: { conditions: [{ type: 'scale', text: 'small collections' }], trusted: false } });
    const excerpt = await reopened.getNode(result.value.excerptIds[0] ?? 'missing');
    if (!excerpt.ok) throw excerpt.error;
    expect(excerpt.value).toMatchObject({ type: 'Excerpt', content: source });
    const edges = await reopened.getEdges({ subject: result.value.claimIds[0], predicate: 'claimDerivedFrom' });
    if (!edges.ok) throw edges.error;
    expect(edges.value.items.map(edge => edge.object)).toEqual(result.value.excerptIds);
  } finally {
    await reopened.close();
  }
});

it('returns typed failed-close diagnostics without exporting, caching or changing the last success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-extraction-retry-'));
  tempPaths.push(dir);
  const dbPath = join(dir, 'graph.sqlite');
  const store = SQLiteStore.open(dbPath);
  const first = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(),
    llm: new RecordingLlm([payload(), grounded]), cache: new MemoryCache(), config: config() });
  if (!first.ok) throw first.error;
  const initial = await first.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
  if (!initial.ok) throw initial.error;
  const before = await store.exportSnapshot({ scope: 'full' });
  if (!before.ok) throw before.error;
  const cache = new CapturingCache();
  let downstreamCalls = 0;
  const failed = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(),
    llm: new RecordingLlm(['invalid', 'still invalid']), cache, config: config(),
    exporter: { export: async () => { downstreamCalls += 1; throw new Error('exporter must not run'); } },
    referenceExtractor: { extract: async () => { downstreamCalls += 1; throw new Error('references must not run'); } },
    classifier: { classify: async () => { downstreamCalls += 1; throw new Error('classifier must not run'); } } });
  if (!failed.ok) throw failed.error;
  const closed = await failed.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
  expect(closed.ok).toBe(false);
  if (closed.ok) throw new Error('Expected a failed-close result');
  expect(closed.error).toBeInstanceOf(SourceDistillationClosedError);
  expect((closed.error as SourceDistillationClosedError).diagnostics).toEqual(expect.arrayContaining([
    expect.stringContaining('Schema invalid after one repair'),
  ]));
  expect((closed.error as SourceDistillationClosedError).summary.failedClosed).toBe(true);
  expect(cache.writes).toBe(0);
  expect(downstreamCalls).toBe(0);
  const after = await store.exportSnapshot({ scope: 'full' });
  expect(after).toEqual(before);
  await first.value.close();
  await failed.value.close();
  await store.close();
  const reopened = SQLiteStore.open(dbPath);
  try {
    const persisted = await reopened.exportSnapshot({ scope: 'full' });
    expect(persisted).toEqual(before);
    const read = await readExtractionSnapshot(reopened, initial.value.resourceId);
    expect(read.ok && read.value?.claimIds).toEqual(initial.value.claimIds);
    const retry = await createIngestionRuntime({ store: reopened, miner: new SourceDistillationMiner(),
      llm: new RecordingLlm([payload([{ ...unit,
        text: 'The source also identifies a revised, source-backed claim for small collections.' }]), grounded]),
      cache: new MemoryCache(), config: config() });
    if (!retry.ok) throw retry.error;
    const repeated = await retry.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
    if (!repeated.ok) throw repeated.error;
    expect(repeated.value.claimIds).not.toEqual(initial.value.claimIds);
    const later = await readExtractionSnapshot(reopened, repeated.value.resourceId);
    expect(later.ok && later.value?.claimIds).toEqual(repeated.value.claimIds);
    await retry.value.close();
  } finally { await reopened.close(); }
  // A new source that never committed has no Resource to fabricate in an error report.
  const newStore = SQLiteStore.createInMemory();
  try {
    const fresh = await createIngestionRuntime({ store: newStore, miner: new SourceDistillationMiner(),
      llm: new RecordingLlm(['invalid', 'still invalid']), cache: new MemoryCache(), config: config() });
    if (!fresh.ok) throw fresh.error;
    expect((await fresh.value.runVector(makeVector('synthetic:new'), { ref: 'synthetic:new' })).ok).toBe(false);
    expect(await newStore.getNode('synthetic:new')).toMatchObject({ ok: true, value: null });
    await fresh.value.close();
  } finally { await newStore.close(); }
});

it('preserves typed failed-close diagnostics when reported usage also exceeds the cost ceiling', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    const cache = new CapturingCache();
    const created = await createIngestionRuntime({ store, config: config(), cache, costCeiling: { maxTokens: 1 },
      miner: { extractionSnapshotVersion: 1, cacheIdentity: 'failed-close-over-budget',
        mine: async () => ({ ok: true as const, value: { claims: [], tokenUsage: 200,
          distillation: { failedClosed: true, diagnostics: ['reported usage exceeded ceiling'] } } }) } });
    if (!created.ok) throw created.error;
    const result = await created.value.runVector(makeVector('synthetic:over-budget'), { ref: 'synthetic:over-budget' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a failed-close result');
    expect(result.error).toBeInstanceOf(SourceDistillationClosedError);
    expect((result.error as SourceDistillationClosedError).tokenUsage).toBe(200);
    expect((result.error as SourceDistillationClosedError).diagnostics).toEqual(['reported usage exceeded ceiling']);
    expect((result.error as SourceDistillationClosedError).summary).toEqual({ failedClosed: true,
      diagnostics: ['reported usage exceeded ceiling'] });
    expect(cache.writes).toBe(0);
    expect(await store.getNode('synthetic:over-budget')).toMatchObject({ ok: true, value: null });
    await created.value.close();
  } finally { await store.close(); }
});

it.each([true, false])('exposes a final-write failure after changed graph writes (transaction=%s)', async transactional => {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-extraction-rollback-'));
  tempPaths.push(dir);
  const dbPath = join(dir, 'graph.sqlite');
  const store = SQLiteStore.open(dbPath);
  const first = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(),
    llm: new RecordingLlm([payload(), grounded]), cache: new MemoryCache(), config: config() });
  if (!first.ok) throw first.error;
  const initial = await first.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
  if (!initial.ok) throw initial.error;
  const before = await store.exportSnapshot({ scope: 'full' });
  if (!before.ok) throw before.error;
  const oldSnapshot = await readExtractionSnapshot(store, initial.value.resourceId);
  if (!oldSnapshot.ok || !oldSnapshot.value) throw new Error('Missing first checkpoint');
  const oldCandidateHash = oldSnapshot.value.candidateHash;
  const changedSource = `${source} A later source note changes the excerpt.`;
  const changedClaim = 'A changed source-backed claim about linked index files and small collections.';
  const observed: string[] = [];
  const failedStore = new Proxy(store, { get(target, property, receiver) {
    if (property === 'runInTransaction' && !transactional) {
      return async <T>(work: () => Promise<Result<T>>) => work();
    }
    if (property === 'upsertNode') return async (...args: Parameters<GraphStore['upsertNode']>) => {
      const next = args[2].metadata?.['extractionSnapshot'] as { candidateHash?: string } | undefined;
      if (args[0] === 'Resource' && next?.candidateHash !== undefined &&
          next.candidateHash !== oldCandidateHash) {
        return { ok: false as const, error: new Error('injected final snapshot write failure') };
      }
      const written = await target.upsertNode(...args);
      if (written.ok && (args[0] === 'Claim' || args[0] === 'Excerpt')) {
        const visible = await target.getNode(args[1]);
        if (visible.ok && visible.value?.content === args[2].content) observed.push(args[0]);
      }
      return written;
    };
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) as GraphStore;
  const cache = new CapturingCache();
  const failed = await createIngestionRuntime({ store: failedStore, miner: new SourceDistillationMiner(),
    llm: new RecordingLlm([payload([{ ...unit, text: changedClaim }]), grounded]),
    cache, config: config() });
  if (!failed.ok) throw failed.error;
  const result = await failed.value.runVector(makeVector('synthetic:checkpoint', [],
    { ownerNote: 'retain me' }, changedSource), { ref: 'synthetic:checkpoint' });
  expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: 'injected final snapshot write failure' }) });
  expect(observed).toEqual(expect.arrayContaining(['Excerpt', 'Claim']));
  expect(cache.writes).toBe(0);
  await first.value.close();
  await failed.value.close();
  await store.close();
  const reopened = SQLiteStore.open(dbPath);
  try {
    const after = await reopened.exportSnapshot({ scope: 'full' });
    if (transactional) expect(after).toEqual(before);
    else expect(after).not.toEqual(before); // Adverse control: the same fault leaks writes without the transaction.
    const read = await readExtractionSnapshot(reopened, initial.value.resourceId);
    expect(read.ok && read.value?.claimIds).toEqual(initial.value.claimIds);
  } finally { await reopened.close(); }
});

it.each(['final-snapshot', 'claim-evidence-edge'] as const)(
  'leaves no partial graph or cache on the first extraction when %s fails', async failurePoint => {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-extraction-first-failure-'));
  tempPaths.push(dir);
  const dbPath = join(dir, 'graph.sqlite');
  const store = SQLiteStore.open(dbPath);
  const observed: string[] = [];
  const failedStore = new Proxy(store, { get(target, property, receiver) {
    if (property === 'upsertNode') return async (...args: Parameters<GraphStore['upsertNode']>) => {
      if (failurePoint === 'final-snapshot' && args[0] === 'Resource' && args[2].metadata?.['extractionSnapshot']) {
        return { ok: false as const, error: new Error('injected export write failure') };
      }
      const written = await target.upsertNode(...args);
      if (written.ok && (args[0] === 'Claim' || args[0] === 'Excerpt')) observed.push(args[0]);
      return written;
    };
    if (property === 'upsertEdge') return async (...args: Parameters<GraphStore['upsertEdge']>) => {
      if (failurePoint === 'claim-evidence-edge' && args[1] === 'claimDerivedFrom') {
        return { ok: false as const, error: new Error('injected export write failure') };
      }
      return target.upsertEdge(...args);
    };
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) as GraphStore;
  const cache = new CapturingCache();
  const created = await createIngestionRuntime({ store: failedStore, miner: new SourceDistillationMiner(),
    llm: new RecordingLlm([payload(), grounded]), cache, config: config() });
  if (!created.ok) throw created.error;
  const failed = await created.value.runVector(makeVector('synthetic:first-failure'), { ref: 'synthetic:first-failure' });
  expect(failed).toMatchObject({ ok: false,
    error: expect.objectContaining({ message: 'injected export write failure' }) });
  expect(observed).toEqual(expect.arrayContaining(['Excerpt', 'Claim']));
  expect(cache.writes).toBe(0);
  await created.value.close();
  await store.close();
  const reopened = SQLiteStore.open(dbPath);
  try {
    expect(await reopened.getNode('synthetic:first-failure')).toMatchObject({ ok: true, value: null });
    const graph = await reopened.exportSnapshot({ scope: 'full' });
    if (!graph.ok) throw graph.error;
    expect(graph.value.nodes).toEqual([]);
    expect(graph.value.edges).toEqual([]);
  } finally { await reopened.close(); }
});

it('rejects missing or mismatched cache snapshots and reuses a matching committed result', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    const recording = new CapturingCache();
    const seededLlm = new RecordingLlm([payload(), grounded]);
    const first = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(), llm: seededLlm,
      cache: recording, config: config() });
    if (!first.ok) throw first.error;
    const firstRun = await first.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
    if (!firstRun.ok) throw firstRun.error;
    const firstSnapshot = firstRun.value.extractionSnapshot;
    if (!firstSnapshot) throw new Error('Expected the first snapshot');
    expect(Object.hasOwn(firstSnapshot.proposal, 'sourcePurpose')).toBe(false);
    expect(Object.hasOwn(firstSnapshot.report, 'sourcePurpose')).toBe(false);
    for (const field of ['rationale', 'conditions', 'attribution', 'supportsUnitIds']) {
      expect(Object.hasOwn(firstSnapshot.proposal.units[0] ?? {}, field), field).toBe(false);
      expect(Object.hasOwn(firstSnapshot.finalUnits[0] ?? {}, field), field).toBe(false);
      expect(Object.hasOwn(firstRun.value.claims[0]?.metadata ?? {}, field), field).toBe(false);
    }
    expect(recording.writes).toBe(1);
    const valid = recording.lastWrite;
    if (!valid) throw new Error('No committed extraction was cached');
    for (const change of ['missing-both', 'wrong-source', 'wrong-identity', 'unknown-excerpt',
      'changed-final-text', 'changed-proposal', 'future-proposal', 'failed-final-quote', 'reprojected-kind'] as const) {
      const stale = { ...JSON.parse(valid) as MiningResult };
      const candidate = stale.extractionSnapshotCandidate;
      const firstFinal = candidate?.finalUnits[0];
      const firstEvidence = firstFinal?.evidence[0];
      const firstProposal = candidate?.proposal.units[0];
      if (!candidate || !firstFinal || !firstEvidence || !firstProposal) throw new Error('Expected complete cached fixture');
      if (change === 'missing-both') {
        delete stale['distillation'];
        delete stale['extractionSnapshotCandidate'];
      } else if (change === 'wrong-source') candidate.sourceCanonicalId = 'other:source';
      else if (change === 'wrong-identity') candidate.minerIdentity = 'other-miner';
      else if (change === 'unknown-excerpt') firstEvidence.excerptId = 'other-excerpt';
      else if (change === 'changed-final-text') firstFinal.text =
        'This alternative claim has enough text for the schema but contradicts the exported Claim.';
      else if (change === 'changed-proposal') firstProposal.id = 'other-unit';
      else if (change === 'future-proposal') Reflect.set(candidate.proposal, 'schemaVersion', 2);
      else if (change === 'reprojected-kind') {
        firstFinal.kind = 'fact';
        const output = buildDistillationOutput({ extractionIntent: candidate.extractionIntent,
          sourceType: candidate.proposal.sourceType, sourcePurpose: candidate.proposal.sourcePurpose,
          sourceCoherence: candidate.proposal.sourceCoherence, theses: candidate.proposal.theses,
          units: candidate.finalUnits, rejectedUnits: candidate.rejectedUnits,
          coverage: candidate.report.coverage, diagnostics: candidate.preProjectionDiagnostics,
          model: candidate.model, promptVersion: candidate.promptVersion });
        const projectedCandidate = parseSnapshotCandidate({ ...candidate,
          supportingUnits: output.supportingUnits, report: output.distillation });
        if (!projectedCandidate) throw new Error('Expected a valid reprojected cached candidate');
        stale.extractionSnapshotCandidate = projectedCandidate;
        Object.assign(stale, output, { distillation: { ...output.distillation, failedClosed: false } });
        expect(snapshotMatchesMiningResult(projectedCandidate, { ...stale,
          extractionSnapshotCandidateHash: hashSnapshotCandidate(projectedCandidate) })).toBe(true);
      }
      else Reflect.set(firstEvidence, 'quoteVerification', 'failed');
      if (stale['extractionSnapshotCandidate']) {
        stale['extractionSnapshotCandidateHash'] = hashSnapshotCandidate(stale['extractionSnapshotCandidate']);
      }
      const llm = new RecordingLlm([payload(), grounded]);
      const cache = new CapturingCache(JSON.stringify(stale));
      const created = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(), llm,
        cache, config: config() });
      if (!created.ok) throw created.error;
      const run = await created.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
      if (!run.ok) throw run.error;
      expect(run.value.cacheHits, change).toBe(0);
      expect(cache.writes, change).toBe(1);
      expect(llm.requests, change).toHaveLength(2);
      await created.value.close();
    }
    const noLlm = new RecordingLlm([]);
    const hit = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(), llm: noLlm,
      cache: new CapturingCache(valid), config: config() });
    if (!hit.ok) throw hit.error;
    const reused = await hit.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
    if (!reused.ok) throw reused.error;
    expect(reused.value.cacheHits).toBe(1);
    expect(noLlm.requests).toHaveLength(0);
    expect(reused.value.extractionSnapshot).toEqual(firstSnapshot);
    await hit.value.close();
    await first.value.close();
  } finally { await store.close(); }
});

it('accepts an opted-in wrapper whose optional undefined fields disappear on the JSON wire', async () => {
  const store = SQLiteStore.createInMemory();
  const delegate = new SourceDistillationMiner();
  const wrapper: ICandidateMiner = {
    extractionSnapshotVersion: 1,
    cacheIdentity: delegate.cacheIdentity,
    async mine(miningRequest) {
      const mined = await delegate.mine(miningRequest);
      if (!mined.ok) return mined;
      return { ok: true, value: {
        ...mined.value,
        claims: mined.value.claims.map(claim => ({ ...claim,
          metadata: { ...claim.metadata, rationale: undefined } })),
        distillation: mined.value.distillation && { ...mined.value.distillation, sourcePurpose: undefined },
      } };
    },
  };
  try {
    const cache = new CapturingCache();
    const first = await createIngestionRuntime({ store, config: config(), miner: wrapper,
      llm: new RecordingLlm([payload(), grounded]), cache });
    if (!first.ok) throw first.error;
    const fresh = await first.value.runVector(makeVector('synthetic:wrapper'), { ref: 'synthetic:wrapper' });
    if (!fresh.ok) throw fresh.error;
    expect(fresh.value.extractionSnapshot?.trusted).toBe(false);
    expect(Object.hasOwn(fresh.value.claims[0]?.metadata ?? {}, 'rationale')).toBe(true);
    expect(Object.hasOwn(fresh.value.extractionSnapshot?.report ?? {}, 'sourcePurpose')).toBe(false);
    const saved = cache.lastWrite;
    if (!saved) throw new Error('Missing committed cache record');
    const noLlm = new RecordingLlm([]);
    const reused = await createIngestionRuntime({ store, config: config(), miner: wrapper,
      llm: noLlm, cache: new CapturingCache(saved) });
    if (!reused.ok) throw reused.error;
    const hit = await reused.value.runVector(makeVector('synthetic:wrapper'), { ref: 'synthetic:wrapper' });
    if (!hit.ok) throw hit.error;
    expect(hit.value.cacheHits).toBe(1);
    expect(hit.value.extractionSnapshot).toEqual(fresh.value.extractionSnapshot);
    expect(noLlm.requests).toHaveLength(0);
    await reused.value.close();
    await first.value.close();
  } finally { await store.close(); }
});

it('retains a legitimate grounding rewrite through configured runtime and cached snapshot replay', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    const proposalUnits = [unit, { ...unit, id: 'u2', kind: 'procedure', importance: 'supporting',
      text: 'The chair can follow the linked index files for small collections.' }];
    const corrected = 'The chair recommends following linked index files only for this small collection.';
    const reply = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' },
      { unitId: 'u2', verdict: 'rewrite', text: corrected, importance: 'core',
        rationale: 'The chair describes this only for small collections.' }] });
    const cache = new CapturingCache();
    const llm = new RecordingLlm([payload(proposalUnits), reply]);
    const miner = new SourceDistillationMiner();
    const created = await createIngestionRuntime({ store, miner, llm, cache, config: config() });
    if (!created.ok) throw created.error;
    const fresh = await created.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
    if (!fresh.ok) throw fresh.error;
    expect(fresh.value.extractionSnapshot?.finalUnits.find(value => value.id === 'u2')).toMatchObject({
      text: corrected, importance: 'core', rationale: 'The chair describes this only for small collections.' });
    const saved = cache.lastWrite;
    if (!saved) throw new Error('Expected committed rewritten snapshot');
    const noLlm = new RecordingLlm([]);
    const replay = await createIngestionRuntime({ store, miner, llm: noLlm,
      cache: new CapturingCache(saved), config: config() });
    if (!replay.ok) throw replay.error;
    const hit = await replay.value.runVector(makeVector(), { ref: 'synthetic:checkpoint' });
    if (!hit.ok) throw hit.error;
    expect(hit.value.cacheHits).toBe(1);
    expect(hit.value.extractionSnapshot).toEqual(fresh.value.extractionSnapshot);
    expect(noLlm.requests).toHaveLength(0);
    await replay.value.close();
    await created.value.close();
  } finally { await store.close(); }
});

it.each([Number.NaN, () => 'non-JSON'])(
  'rejects a snapshot sibling with a non-JSON claim metadata value', async invalidValue => {
    const mined = await new SourceDistillationMiner().mine(request(new RecordingLlm([payload(), grounded])));
    if (!mined.ok) throw mined.error;
    const candidate = mined.value.extractionSnapshotCandidate;
    if (!candidate) throw new Error('Missing candidate');
    const damaged = { ...mined.value, claims: mined.value.claims.map(claim => ({ ...claim,
      metadata: { ...claim.metadata, reviewerField: invalidValue } })) };
    expect(snapshotMatchesMiningResult(candidate, damaged)).toBe(false);
  });

it('rejects a throwing metadata getter without escaping snapshot admission', async () => {
  const mined = await new SourceDistillationMiner().mine(request(new RecordingLlm([payload(), grounded])));
  if (!mined.ok) throw mined.error;
  const candidate = mined.value.extractionSnapshotCandidate;
  const claim = mined.value.claims[0];
  if (!candidate || !claim) throw new Error('Missing candidate or claim');
  const metadata = { ...claim.metadata };
  Object.defineProperty(metadata, 'reviewerField', { enumerable: true, get() {
    throw new Error('untrusted getter must not escape admission');
  } });
  const damaged = { ...mined.value, claims: [{ ...claim, metadata }] };
  expect(snapshotMatchesMiningResult(candidate, damaged)).toBe(false);
});

it('leaves a custom miner without snapshot capability on the legacy export path', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    let mineCalls = 0;
    const created = await createIngestionRuntime({ store, config: config(), cache: new MemoryCache(),
      miner: { cacheIdentity: 'legacy-custom-miner', mine: async () => {
        mineCalls += 1;
        return { ok: true as const,
          value: { claims: [], distillation: { failedClosed: false, diagnostics: [] } } };
      } } });
    if (!created.ok) throw created.error;
    const result = await created.value.runVector(makeVector('synthetic:legacy'), { ref: 'synthetic:legacy' });
    if (!result.ok) throw result.error;
    expect(result.value.extractionSnapshot).toBeUndefined();
    expect(await readExtractionSnapshot(store, result.value.resourceId)).toEqual({ ok: true, value: null });
    const cached = await created.value.runVector(makeVector('synthetic:legacy'), { ref: 'synthetic:legacy' });
    if (!cached.ok) throw cached.error;
    expect(cached.value.cacheHits).toBe(1);
    expect(mineCalls).toBe(1);
    await created.value.close();
  } finally { await store.close(); }
});

it('stores a dedup alias checkpoint on the resolved Resource and ignores forged source metadata', async () => {
  const sanitized = createRawSource({ canonicalId: 'web:primary', sourceType: 'web', sensitivity: 'public',
    label: 'Primary', payload: {}, clock: { now: () => new Date('2026-10-17T00:00:00Z') },
    resourceMetadata: { ownerNote: 'real', extractionSnapshot: { forged: true } } });
  expect(sanitized.resourceMetadata).toEqual({ ownerNote: 'real' });
  const store = SQLiteStore.createInMemory();
  try {
    const initial = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(),
      llm: new RecordingLlm([payload(), grounded]), cache: new MemoryCache(), config: config() });
    if (!initial.ok) throw initial.error;
    const first = await initial.value.runVector(makeVector('web:primary', [], { ownerNote: 'real' }), { ref: 'web:primary' });
    if (!first.ok) throw first.error;
    const alias = await createIngestionRuntime({ store, miner: new SourceDistillationMiner(),
      llm: new RecordingLlm([payload(), grounded]), cache: new MemoryCache(), config: config() });
    if (!alias.ok) throw alias.error;
    const second = await alias.value.runVector(makeVector('web:alias', ['web:primary'],
      { ownerNote: 'attempted change', extractionSnapshot: { forged: true } }), { ref: 'web:alias' });
    if (!second.ok) throw second.error;
    expect(second.value.resourceId).toBe('web:primary');
    expect(second.value.dedupAction).toBe('merge');
    const resource = await store.getNode('web:primary');
    if (!resource.ok) throw resource.error;
    const resourceNode = resource.value;
    if (!resourceNode) throw new Error('Missing primary Resource');
    expect(resourceNode.metadata?.['ownerNote']).toBe('real');
    const read = await readExtractionSnapshot(store, 'web:primary');
    if (!read.ok) throw read.error;
    expect(read.value).toMatchObject({ resourceId: 'web:primary', sourceCanonicalId: 'web:alias', trusted: false });
    expect(await store.getNode('web:alias')).toMatchObject({ ok: true, value: null });
    for (const damage of ['outer-version', 'proposal-version', 'failed-final-quote'] as const) {
      const corruptSnapshot = structuredClone(read.value);
      if (!corruptSnapshot) throw new Error('Missing alias checkpoint');
      if (damage === 'outer-version') (corruptSnapshot as { schemaVersion: number }).schemaVersion = 2;
      else if (damage === 'proposal-version') (corruptSnapshot.proposal as { schemaVersion: number }).schemaVersion = 2;
      else (corruptSnapshot.finalUnits[0]?.evidence[0] as { quoteVerification: string }).quoteVerification = 'failed';
      const corrupt = await store.upsertNode('Resource', 'web:primary', { label: resourceNode.label,
        content: resourceNode.content, metadata: { ...resourceNode.metadata,
          extractionSnapshot: corruptSnapshot } });
      if (!corrupt.ok) throw corrupt.error;
      expect(await readExtractionSnapshot(store, 'web:primary'), damage).toMatchObject({ ok: false,
        error: expect.objectContaining({ message: expect.stringContaining('Invalid or unsupported') }) });
    }
    await initial.value.close();
    await alias.value.close();
  } finally { await store.close(); }
});
