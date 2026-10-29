import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SQLiteStore } from '@aidha/graph-backend';
import { SourceDistillationMiner, composeVector, createIngestionRuntimeFromServices } from '../../src/index.js';
import { createDefaultPipelineServices } from '../../src/pipeline/services.js';
import { RecordingLlm, config, payload, request } from '../extract/distill/fixture.js';

// Frozen public supplier trial: generated u4 and its full cited alert-3 excerpt.
const source = "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning. Until then, keep the existing eight-unit threshold outside the five trial machines. This is a conditional recommendation by the operations lead, distinct from the supplier's original six-unit proposal. The regulator attended as an observer and gave no endorsement or threshold instruction at the meeting.";
const originalQuote = "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning. Until then, keep the existing eight-unit threshold outside the five trial machines.";
const segmentedEvidence = [
  { excerptId: 'alert-3', quote: "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning.", quoteVerification: 'exact' },
  { excerptId: 'alert-3', quote: 'Until then, keep the existing eight-unit threshold outside the five trial machines.', quoteVerification: 'exact' },
];
const originalUnit = {
  id: 'u4', kind: 'recommendation',
  text: 'Maintain the existing eight-unit vibration alert threshold outside the five trial machines, and consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning.',
  rationale: null,
  conditions: [{ type: 'assumption', text: 'nuisance-alert share falls below one in ten for four consecutive weeks after tuning' },
    { type: 'exclusion', text: 'outside the five trial machines' }],
  attribution: { kind: 'third_party', name: null, role: 'operations lead' },
  stance: 'recommended', evidence: [{ excerptId: 'alert-3', quote: originalQuote }],
  supportsUnitIds: null, importance: 'core',
};
const vector = composeVector({
  sourceId: 'synthetic', sensitivity: 'public',
  registration: { sourceId: 'synthetic', validateActiveSourceConfig: value => value },
  ingestor: { sourceId: 'synthetic', acquire: () => Promise.resolve({ ok: true as const,
    value: { canonicalId: 'synthetic:source-34', sourceType: 'web' as const, label: 'Operations review',
      sensitivity: 'public' as const, provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} } }) },
  decode: [{ name: 'synthetic', decode: () => Promise.resolve({ ok: true as const, value: {
    segments: [{ id: 'seg3', text: source,
      locator: { kind: 'text' as const, charStart: 0, charEnd: source.length } }], warnings: [] } }) }],
  context: { build: () => Promise.resolve({}) },
  chunking: { name: 'synthetic', chunk: ({ segments }) => Promise.resolve({ ok: true as const,
    value: [{ id: 'alert-3', text: source, segments,
      locator: { kind: 'text' as const, charStart: 0, charEnd: source.length } }] }) },
});
const miningInput = (llm: RecordingLlm) => {
  const base = request(llm);
  return { ...base, chunks: [{ id: 'alert-3', text: source, segments: [],
    locator: { kind: 'text' as const, charStart: 0, charEnd: source.length } }] };
};

const sqliteIt = SQLiteStore.isAvailable() ? it : it.skip;
sqliteIt('recovers exact supplier u4 by complete segmentation through the shared runtime and durable graph', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-segmented-evidence-'));
  const dbPath = join(directory, 'graph.db');
  let store: SQLiteStore | undefined;
  try {
    store = SQLiteStore.open(dbPath);
    const llm = new RecordingLlm([payload([originalUnit]),
      JSON.stringify({ verdicts: [{ unitId: 'u4', verdict: 'grounded' }] })]);
    const services = createDefaultPipelineServices({ store, llm,
      miner: new SourceDistillationMiner({ enableSegmentedEvidence: true }), config: config() });
    const result = await createIngestionRuntimeFromServices(services).runVector(vector, { ref: 'synthetic:source-34' });
    if (!result.ok) throw result.error;
    expect(llm.requests).toHaveLength(2);
    expect(result.value.claimsExtracted).toBe(1);
    expect(result.value.sourceDistillation?.segmentRepairs).toMatchObject([{
      unitId: 'u4', status: 'grounded', originalUnit: { evidence: [{ quote: originalQuote, quoteVerification: 'failed' }] },
      replacementEvidence: segmentedEvidence,
    }]);
    await store.close(); store = undefined;
    store = SQLiteStore.open(dbPath);
    const nodes = await store.queryNodes({ type: 'Claim' });
    if (!nodes.ok) throw nodes.error;
    expect(nodes.value.items).toHaveLength(1);
    expect(nodes.value.items[0]?.id).toBe(result.value.claimIds[0]);
    expect(nodes.value.items[0]?.content).toBe(originalUnit.text);
    expect(nodes.value.items[0]?.metadata['unitKind']).toBe('recommendation');
    expect(nodes.value.items[0]?.metadata['trusted']).toBe(false);
    expect(nodes.value.items[0]?.metadata['evidence']).toEqual(segmentedEvidence);
    expect(nodes.value.items[0]?.metadata['conditions']).toEqual(originalUnit.conditions);
    expect(nodes.value.items[0]?.metadata['attribution']).toEqual({ kind: 'third_party', role: 'operations lead' });
  } finally {
    await store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps default failure and cache identity unchanged', async () => {
  const llm = new RecordingLlm([payload([originalUnit])]);
  const miner = new SourceDistillationMiner();
  const result = await miner.mine(miningInput(llm));
  if (!result.ok) throw result.error;
  expect(result.value.claims).toEqual([]);
  expect(result.value.distillation?.failedClosed).toBe(true);
  expect(llm.requests).toHaveLength(1);
  expect(miner.cacheIdentity).not.toContain('segmentedEvidence');
  expect(new SourceDistillationMiner({ enableSegmentedEvidence: true }).cacheIdentity)
    .toContain('complete-segmented-evidence-v1');
});

it.each([
  { label: 'missing verdict', verdict: JSON.stringify({ verdicts: [] }) },
  { label: 'duplicate verdict', verdict: JSON.stringify({ verdicts: [
    { unitId: 'u4', verdict: 'grounded' }, { unitId: 'u4', verdict: 'grounded' }] }) },
  { label: 'mixed malformed verdict', verdict: JSON.stringify({ verdicts: [
    { unitId: 'u4', verdict: 'grounded' }, { unitId: 'u4', verdict: 'invented' }] }) },
  { label: 'rewrite verdict', verdict: JSON.stringify({ verdicts: [
    { unitId: 'u4', verdict: 'rewrite', text: 'Roll the six-unit threshold out to all machines now.' }] }) },
  { label: 'ungrounded verdict', verdict: JSON.stringify({ verdicts: [{ unitId: 'u4', verdict: 'ungrounded' }] }) },
  { label: 'transport failure', verdict: { ok: false as const, error: new Error('judge unavailable') } },
])('retains original failed evidence when segmented-unit review has $label', async ({ verdict }) => {
  const llm = new RecordingLlm([payload([originalUnit]), verdict]);
  const result = await new SourceDistillationMiner({ enableSegmentedEvidence: true,
    quoteFailureCloseThreshold: 1 }).mine(miningInput(llm));
  if (!result.ok) throw result.error;
  expect(llm.requests).toHaveLength(2);
  expect(result.value.claims).toEqual([]);
  expect(result.value.rejectedClaims).toMatchObject([{ text: originalUnit.text,
    metadata: { unitId: 'u4', rejectionReason: 'failed_quote_verification',
      evidence: [{ quote: originalQuote, quoteVerification: 'failed' }] } }]);
  expect(result.value.distillation?.segmentRepairs).toMatchObject([{ unitId: 'u4', status: 'rejected',
    originalUnit: { evidence: [{ quote: originalQuote, quoteVerification: 'failed' }] } }]);
});

it('counts an ungrounded provisional segment repair against the final quote-failure threshold', async () => {
  const valid = { id: 'u5', kind: 'fact',
    text: 'The regulator observed the meeting without endorsing or instructing a threshold.',
    stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'alert-3', quote: 'The regulator attended as an observer and gave no endorsement or threshold instruction at the meeting.' }] };
  const llm = new RecordingLlm([payload([originalUnit, valid]), JSON.stringify({ verdicts: [
    { unitId: 'u4', verdict: 'ungrounded' }, { unitId: 'u5', verdict: 'grounded' },
  ] })]);
  const result = await new SourceDistillationMiner({ enableSegmentedEvidence: true,
    quoteFailureCloseThreshold: 0.3 }).mine(miningInput(llm));
  if (!result.ok) throw result.error;
  expect(llm.requests).toHaveLength(2);
  expect(result.value.claims).toEqual([]);
  expect(result.value.distillation?.failedClosed).toBe(true);
  expect(result.value.distillation?.segmentRepairs).toMatchObject([{ unitId: 'u4', status: 'rejected' }]);
});

it('fails closed on invalid grounding-call usage and retains the original audit', async () => {
  const llm = new RecordingLlm([payload([originalUnit]), { ok: true,
    value: JSON.stringify({ verdicts: [{ unitId: 'u4', verdict: 'grounded' }] }),
    usage: { inputTokens: -1, outputTokens: 0, totalTokens: -1 } }]);
  const result = await new SourceDistillationMiner({ enableSegmentedEvidence: true }).mine(miningInput(llm));
  if (!result.ok) throw result.error;
  expect(llm.requests).toHaveLength(2);
  expect(result.value.claims).toEqual([]);
  expect(result.value.distillation?.failedClosed).toBe(true);
  expect(result.value.distillation?.segmentRepairs).toMatchObject([{ unitId: 'u4', status: 'rejected',
    originalUnit: { evidence: [{ quote: originalQuote, quoteVerification: 'failed' }] } }]);
});

it('does not call grounding when the token ceiling cannot cover it', async () => {
  const llm = new RecordingLlm([{ ok: true, value: payload([originalUnit]),
    usage: { inputTokens: 9000, outputTokens: 500, totalTokens: 9500 } }]);
  const result = await new SourceDistillationMiner({ enableSegmentedEvidence: true }).mine({
    ...miningInput(llm), costCeiling: { maxTokens: 10_000 },
  });
  if (!result.ok) throw result.error;
  expect(llm.requests).toHaveLength(1);
  expect(result.value.claims).toEqual([]);
  expect(result.value.distillation?.failedClosed).toBe(true);
  expect(result.value.distillation?.segmentRepairs).toMatchObject([{ unitId: 'u4', status: 'rejected' }]);
});

it('does not admit a unit with one literal overlong reference and one fabricated reference', async () => {
  const mixed = { ...originalUnit, evidence: [...originalUnit.evidence,
    { excerptId: 'alert-3', quote: 'The regulator ordered a six-unit rollout to every machine.' }] };
  const llm = new RecordingLlm([payload([mixed])]);
  const result = await new SourceDistillationMiner({ enableSegmentedEvidence: true,
    quoteFailureCloseThreshold: 1 }).mine(miningInput(llm));
  if (!result.ok) throw result.error;
  expect(llm.requests).toHaveLength(1);
  expect(result.value.claims).toEqual([]);
  expect(result.value.rejectedClaims).toMatchObject([{ text: originalUnit.text,
    metadata: { rejectionReason: 'failed_quote_verification' } }]);
  expect(result.value.distillation?.segmentRepairs).toBeUndefined();
});
