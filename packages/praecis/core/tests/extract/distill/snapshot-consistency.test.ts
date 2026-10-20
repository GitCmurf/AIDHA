import { expect, it } from 'vitest';
import { SourceDistillationMiner } from '../../../src/extract/distill/miner.js';
import { buildDistillationOutput } from '../../../src/extract/distill/report.js';
import { hashSnapshotCandidate, parseSnapshotCandidate, snapshotMatchesInput,
  snapshotMatchesMiningResult, type ExtractionSnapshotCandidate } from '../../../src/extract/distill/snapshot.js';
import { RecordingLlm, payload, request, source, unit } from './fixture.js';

const proposals = [
  unit,
  { ...unit, id: 'u2', kind: 'procedure', importance: 'supporting',
    text: 'The chair can follow the linked index files for small collections.' },
  { ...unit, id: 'u3', text: 'The chair describes a source-backed use of explicit index links.' },
  { ...unit, id: 'u4', text: 'This purported observation cites nonexistent source words.',
    evidence: [{ excerptId: 'ex1', quote: 'a nonexistent statement absent from the source passage' }] },
];
const excerpts = new Map([['ex1', source]]);

async function original() {
  const miner = new SourceDistillationMiner({ quoteFailureCloseThreshold: 1 });
  const llm = new RecordingLlm([payload(proposals), JSON.stringify({ verdicts: proposals.slice(0, 3)
    .map(value => ({ unitId: value.id, verdict: 'grounded' })) })]);
  const mined = await miner.mine(request(llm));
  if (!mined.ok) throw mined.error;
  const candidate = mined.value.extractionSnapshotCandidate;
  if (!candidate) throw new Error('Expected complete synthetic snapshot');
  expect(candidate.rejectedUnits.map(item => item.unit.id)).toEqual(['u4']);
  expect(snapshotMatchesInput(candidate, 'synthetic:wiki', miner.cacheIdentity, excerpts)).toBe(true);
  return { candidate, result: mined.value };
}

function reproject(candidate: ExtractionSnapshotCandidate, originalResult: Awaited<ReturnType<typeof original>>['result']) {
  const output = buildDistillationOutput({ extractionIntent: candidate.extractionIntent,
    sourceType: candidate.proposal.sourceType, sourcePurpose: candidate.proposal.sourcePurpose,
    sourceCoherence: candidate.proposal.sourceCoherence, theses: candidate.proposal.theses,
    units: candidate.finalUnits, rejectedUnits: candidate.rejectedUnits,
    coverage: candidate.report.coverage, diagnostics: candidate.preProjectionDiagnostics,
    limitationsByTarget: new Map(Object.entries(candidate.limitationApplicability.limitationsByTarget)),
    model: candidate.model, promptVersion: candidate.promptVersion });
  const parsed = parseSnapshotCandidate({ ...candidate, supportingUnits: output.supportingUnits,
    report: output.distillation });
  if (!parsed) throw new Error('Expected structurally valid reprojected candidate');
  const result = { ...originalResult, ...output, distillation: { ...output.distillation, failedClosed: false },
    extractionSnapshotCandidate: parsed, extractionSnapshotCandidateHash: hashSnapshotCandidate(parsed) };
  expect(snapshotMatchesMiningResult(parsed, result)).toBe(true);
  return parsed;
}

it.each(['threshold', 'intent', 'prompt'] as const)(
  'rejects an internally reprojected official snapshot that contradicts its %s identity', async field => {
    const { candidate, result } = await original();
    let mutation: ExtractionSnapshotCandidate;
    let selectedIdentity = candidate.minerIdentity;
    if (field === 'threshold') {
      selectedIdentity = new SourceDistillationMiner({ quoteFailureCloseThreshold: 0.1 }).cacheIdentity;
      mutation = { ...candidate, minerIdentity: selectedIdentity };
    } else if (field === 'intent') mutation = { ...candidate, extractionIntent: 'runbook' };
    else mutation = { ...candidate, promptVersion: 'another-prompt-version' };
    const altered = reproject(mutation, result);
    expect(snapshotMatchesInput(altered, 'synthetic:wiki', selectedIdentity, excerpts)).toBe(false);
  });

it.each(['wrong-rejection-reason', 'failed-as-ungrounded', 'changed-ungrounded-unit',
  'changed-kind', 'changed-support-targets', 'substituted-exact-evidence'] as const)(
  'rejects internally reprojected %s while the original proposal is unchanged', async change => {
    const { candidate, result } = await original();
    const finalUnits = [...candidate.finalUnits];
    const rejectedUnits = [...candidate.rejectedUnits];
    const index = finalUnits.findIndex(value => value.id === 'u2');
    const selected = finalUnits[index];
    if (!selected) throw new Error('Missing quoted procedure unit');
    if (change === 'failed-as-ungrounded') {
      const failed = rejectedUnits[0];
      if (!failed) throw new Error('Missing failed-quote rejection');
      rejectedUnits[0] = { ...failed, reason: 'ungrounded' };
    } else if (change === 'wrong-rejection-reason' || change === 'changed-ungrounded-unit') {
      finalUnits.splice(index, 1);
      rejectedUnits.push(change === 'wrong-rejection-reason'
        ? { unit: selected, reason: 'failed_quote_verification' }
        : { unit: { ...selected, text: 'A different rejected statement was substituted.' }, reason: 'ungrounded' });
    } else if (change === 'changed-kind') finalUnits[index] = { ...selected, kind: 'fact' };
    else if (change === 'changed-support-targets') finalUnits[index] = { ...selected, supportsUnitIds: ['u1'] };
    else finalUnits[index] = { ...selected, evidence: [{ excerptId: 'ex1',
      quote: 'The committee chair describes this approach for small collections', quoteVerification: 'exact' }] };
    const altered = reproject({ ...candidate, finalUnits, rejectedUnits }, result);
    expect(snapshotMatchesInput(altered, 'synthetic:wiki', candidate.minerIdentity, excerpts)).toBe(false);
  });

it('admits a real grounded rewrite with changed prose and qualification after cache revalidation', async () => {
  const proposalUnits = [unit, { ...unit, id: 'u2', kind: 'procedure', importance: 'supporting',
    text: 'The chair can follow the linked index files for small collections.' }];
  const revisedText = 'The chair recommends following linked index files only for the small collection described here.';
  const llm = new RecordingLlm([payload(proposalUnits), JSON.stringify({ verdicts: [
    { unitId: 'u1', verdict: 'grounded' },
    { unitId: 'u2', verdict: 'rewrite', text: revisedText, importance: 'core',
      rationale: 'This applies to the small collection discussed by the chair.' },
  ] })]);
  const miner = new SourceDistillationMiner();
  const mined = await miner.mine(request(llm));
  if (!mined.ok) throw mined.error;
  const candidate = mined.value.extractionSnapshotCandidate;
  if (!candidate) throw new Error('Expected rewritten candidate');
  expect(candidate.finalUnits.find(value => value.id === 'u2')).toMatchObject({ text: revisedText,
    importance: 'core', rationale: 'This applies to the small collection discussed by the chair.' });
  expect(snapshotMatchesInput(candidate, 'synthetic:wiki', miner.cacheIdentity, excerpts)).toBe(true);
  expect(snapshotMatchesMiningResult(candidate, mined.value)).toBe(true);
});

it('keeps a custom opaque identity valid when its candidate is otherwise unchanged', async () => {
  const { candidate, result } = await original();
  const identity = 'custom-v1-source-miner';
  const altered = reproject({ ...candidate, minerIdentity: identity }, result);
  expect(snapshotMatchesInput(altered, 'synthetic:wiki', identity, excerpts)).toBe(true);
});


it('retains the explicit empty map and affirmative IDs on the JSON wire with stable canonical hashing', async () => {
  const { candidate, result } = await original();
  expect(candidate.limitationApplicability).toEqual({ affirmativeGroundingIds: ['u1', 'u2', 'u3'], limitationsByTarget: {} });
  const wire = parseSnapshotCandidate(JSON.parse(JSON.stringify(candidate)));
  expect(wire).toEqual(candidate);
  expect(hashSnapshotCandidate(wire!)).toBe(result.extractionSnapshotCandidateHash);
  expect(snapshotMatchesInput(wire!, 'synthetic:wiki', candidate.minerIdentity, excerpts)).toBe(true);
});

it.each(['unsupported-prompt', 'unknown-grounded-id', 'duplicate-grounded-id', 'reordered-grounded-ids'])(
  'rejects %s in an otherwise rehashed snapshot', async damage => {
    const { candidate, result } = await original();
    const altered = structuredClone(candidate);
    if (damage === 'unsupported-prompt') {
      altered.minerIdentity = JSON.stringify({ ...JSON.parse(altered.minerIdentity), limitation: 'unsupported-version' });
    } else {
      altered.limitationApplicability.affirmativeGroundingIds = damage === 'unknown-grounded-id' ? ['absent']
        : damage === 'duplicate-grounded-id' ? ['u1', 'u1'] : ['u3', 'u2', 'u1'];
    }
    const reprojected = reproject(altered, result);
    expect(snapshotMatchesInput(reprojected, 'synthetic:wiki', reprojected.minerIdentity, excerpts)).toBe(false);
  });
