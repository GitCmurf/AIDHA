import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCorpora } from './run.mjs';
import { buildCategoryRequest } from './category.mjs';
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
  const mixedKind = structuredClone(captures);
  mixedKind[0].evidenceKind = 'recorded-provider';
  assert.throws(() => normalizeNativeCaptures(corpus, 'openrouter', model, mixedKind), /mixed model/);

});

for (const provider of ['openai', 'openrouter']) {
  test(provider + ' category capture preserves five questions and denies partial failure credit', async () => {
    const corpus = (await loadCorpora()).categorization;
    const model = provider === 'openai' ? 'gpt-6-luna' : 'typesafe/jev-1.14';
    const build = value => buildCategoryRequest(value, corpus.taxonomy);
    const captures = corpus.cases.map(value => {
      const request = build(value);
      const ids = Object.keys(request.questions);
      assert.equal(ids.length, 5);
      const choices = ids.map(name => ({ name, type: 'choice', choice: 'not_applicable' }));
      return { caseId: value.id, corpusHash: fingerprint(corpus),
        requestHash: fingerprint(request), nativePayloadHash: fingerprint(nativePayload(provider, request, model)),
        evidenceKind: 'synthetic', durationMs: null,
        rawReply: { model: model + '-fixture-version',
          answers: provider === 'openai' ? choices : Object.fromEntries(
            choices.map(({ name, ...answer }) => [name, answer])) } };
    });
    const before = structuredClone(captures);
    const receipts = normalizeNativeCaptures(corpus, provider, model, captures);
    assert.ok(receipts.every(value => value.status === 'ok' && value.answers.length === 5));
    const baseline = scoreDecisions(corpus, build, receipts);
    const index = corpus.cases.findIndex(value => value.expected.tags.length === 0);
    assert.ok(index >= 0);
    assert.equal(baseline.cases[index].correct, true);
    if (provider === 'openai') {
      const answer = captures[index].rawReply.answers[0];
      captures[index].rawReply.answers[0] = { name: answer.name, type: 'refusal' };
    } else {
      const id = Object.keys(captures[index].rawReply.answers)[0];
      captures[index].rawReply.answers[id].choice = 'invalid-fixture-choice';
    }
    const damaged = structuredClone(captures);
    const failed = normalizeNativeCaptures(corpus, provider, model, captures);
    const report = scoreDecisions(corpus, build, failed);
    assert.equal(report.summary.total, 16);
    assert.equal(report.summary.failedCases, 1);
    assert.equal(report.summary.exactSetCorrect, baseline.summary.exactSetCorrect - 1);
    assert.equal(report.cases[index].correct, false);
    assert.equal(report.cases[index].status, provider === 'openai' ? 'refusal' : 'error');
    assert.equal(report.summary.abstainedCases, 0);
    assert.equal(report.modelQualityMeasured, false);
    assert.equal(report.measurements.totalCostUsd, null);
    assert.deepEqual(failed[index].rawReply, captures[index].rawReply);
    assert.deepEqual(captures, damaged);
    assert.equal(before[index].rawReply.model, captures[index].rawReply.model);
  });
}

test('recorded-provider metadata remains collector-declared and retains provisional labels', async () => {
  const { corpus, model, captures } = await fixture();
  for (const capture of captures) capture.evidenceKind = 'recorded-provider';
  const before = structuredClone(captures);
  const receipts = normalizeNativeCaptures(corpus, 'openrouter', model, captures);
  const report = scoreDecisions(corpus, buildGroundingRequest, receipts);
  assert.equal(report.evidenceKind, 'recorded-provider');
  assert.equal(report.modelQualityMeasured, true);
  assert.equal(report.labelStatus, 'assistant-authored; not human gold');
  assert.equal(report.summary.abstentions, 16);
  assert.equal(report.measurements.totalCostUsd, null);
  assert.deepEqual(captures, before);
});
