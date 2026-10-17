import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCorpora } from './run.mjs';
import { buildGroundingRequest } from './grounding.mjs';
import { fingerprint, scoreDecisions } from './quality.mjs';
import { nativePayload } from './plan.mjs';
import { normalizeNativeCaptures } from './capture.mjs';

async function fixture(provider = 'openrouter') {
  const corpus = (await loadCorpora()).grounding;
  const model = provider === 'openrouter' ? 'typesafe/jev-1.14' : 'gpt-6-luna';
  const captures = corpus.cases.map(c => {
    const request = buildGroundingRequest(c);
    const answer = { type: 'choice', choice: 'unknown' };
    return { caseId: c.id, corpusHash: fingerprint(corpus), requestHash: fingerprint(request),
      nativePayloadHash: fingerprint(nativePayload(provider, request, model)),
      durationMs: 12, evidenceKind: 'synthetic',
      rawReply: { model: `${model}-fixture-version`, answers: provider === 'openrouter'
        ? { verdict: answer } : [{ ...answer, name: 'verdict' }], usage: { input_tokens: 40 } } };
  });
  return { corpus, model, captures, provider };
}

test('replays native captures through the frozen scorer without treating fixtures as measured quality', async () => {
  for (const provider of ['openrouter', 'openai']) {
    const { corpus, model, captures } = await fixture(provider);
    const receipts = normalizeNativeCaptures(corpus, provider, model, captures);
    assert.equal(receipts.length, 16);
    assert.deepEqual(receipts[0].rawReply, captures[0].rawReply);
    assert.equal(receipts[0].nativePayloadHash, captures[0].nativePayloadHash);
    const report = scoreDecisions(corpus, buildGroundingRequest, receipts);
    assert.equal(report.summary.abstentions, 16);
    assert.equal(report.summary.errors, 0);
    assert.equal(report.modelQualityMeasured, false);
    assert.equal(report.measurements.totalCostUsd, null);
    assert.equal(report.measurements.latencyP50Ms, 12);
  }
});

test('preserves raw provider failures and charges instead of assigning unknown or dropping the case', async () => {
  const { corpus, model, captures } = await fixture();
  captures[0].rawReply = { model: `${model}-fixture-version`, error: { message: 'fixture service failure' },
    usage: { input_tokens: 40, cost: 0.001 } };
  captures[1].rawReply = { model: `${model}-fixture-version`, refusal: 'fixture policy refusal' };
  const before = structuredClone(captures);
  const receipts = normalizeNativeCaptures(corpus, 'openrouter', model, captures);
  assert.deepEqual(captures, before);
  assert.deepEqual(receipts[0].rawReply, captures[0].rawReply);
  const report = scoreDecisions(corpus, buildGroundingRequest, receipts);
  assert.equal(report.summary.total, 16);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.refusals, 1);
  assert.equal(report.summary.abstentions, 14);
  assert.equal(report.measurements.knownCostUsd, 0.001);
  assert.equal(report.measurements.totalCostUsd, null);
});

test('blocks changed provider payloads, partial batches, mixed identities and unresolved model failures', async () => {
  const { corpus, model, captures } = await fixture();
  for (const field of ['corpusHash', 'requestHash', 'nativePayloadHash']) {
    const changed = structuredClone(captures);
    changed[0][field] = 'sha256:wrong';
    assert.throws(() => normalizeNativeCaptures(corpus, 'openrouter', model, changed), /hash mismatch/);
  }
  assert.throws(() => normalizeNativeCaptures(corpus, 'openrouter', model, captures.slice(1)), /missing case/);
  assert.throws(() => normalizeNativeCaptures(corpus, 'openrouter', model, [...captures, captures[0]]), /duplicate case/);
  const mixed = structuredClone(captures);
  mixed[0].rawReply.model = 'different-revision';
  assert.throws(() => normalizeNativeCaptures(corpus, 'openrouter', model, mixed), /mixed model/);
  const unresolved = structuredClone(captures);
  unresolved[0].rawReply = { error: { message: 'No identity reported' } };
  assert.throws(() => normalizeNativeCaptures(corpus, 'openrouter', model, unresolved), /no reported model identity/);
  assert.equal(unresolved[0].rawReply.error.message, 'No identity reported');
});
