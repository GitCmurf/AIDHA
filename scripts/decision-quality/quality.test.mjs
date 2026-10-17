import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, stampReceipt, scoreDecisions } from './quality.mjs';

const taxonomy = { tags: [{ id: 'a' }, { id: 'b' }] };
const category = { version: 1, task: 'categorization', labelStatus: 'assistant-authored; not human gold', taxonomy,
  cases: [
    { id: 'c1', split: 'development', source: { canonicalId: 'c1' }, expected: { tags: ['a'] } },
    { id: 'c2', split: 'held-out', source: { canonicalId: 'c2' }, expected: { tags: ['b'] } },
    { id: 'c3', split: 'held-out', source: { canonicalId: 'c3' }, expected: { tags: [] } },
  ] };
const categoryRequest = () => ({ state: { text: 'Public source' }, questions: {
  a: { type: 'choice', choices: ['applies', 'not_applicable', 'unknown'] },
  b: { type: 'choice', choices: ['applies', 'not_applicable', 'unknown'] },
} });
const grounding = { version: 1, task: 'grounding', labelStatus: 'assistant-authored; not human gold', cases: [
  { id: 'g1', split: 'development', expected: { verdict: 'grounded', criticalFalseAccept: false } },
  { id: 'g2', split: 'held-out', expected: { verdict: 'rewrite', criticalFalseAccept: true } },
  { id: 'g3', split: 'held-out', expected: { verdict: 'ungrounded', criticalFalseAccept: true } },
] };
const groundingRequest = () => ({ state: 'Public evidence', questions: {
  verdict: { type: 'choice', criteria: { grounded: 'Supported', rewrite: 'Repairable', ungrounded: 'Unsupported', unknown: 'Uncertain' } },
} });
function receipt(corpus, index, builder, answers, extra = {}) {
  return stampReceipt(corpus, corpus.cases[index], builder(corpus.cases[index]), {
    requestedModel: 'test-model', resolvedModel: 'test-model-v1', endpoint: null,
    evidenceKind: 'synthetic', status: 'ok', answers, rawReply: { fixture: true },
    usage: null, costUsd: null, durationMs: null, ...extra,
  });
}
function categories(choices) {
  return choices.map((pair, i) => receipt(category, i, categoryRequest,
    pair.map((choice, j) => ({ questionId: ['a', 'b'][j], choice }))));
}
function verdicts(choices) {
  return choices.map((choice, i) => receipt(grounding, i, groundingRequest, [{ questionId: 'verdict', choice }]));
}

test('category report counts wrong tags and omissions against persisted observations, with explicit denominators', () => {
  const report = scoreDecisions(category, categoryRequest, categories([
    ['applies', 'applies'], ['not_applicable', 'not_applicable'], ['not_applicable', 'not_applicable'],
  ]));
  assert.equal(report.summary.exactSetCorrect, 1);
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.exactSetAccuracy, 1 / 3);
  assert.deepEqual(report.summary.micro, { truePositives: 1, falsePositives: 1, falseNegatives: 1, precision: 0.5, recall: 0.5 });
  assert.deepEqual(report.cases[0].wrongAssignments, ['b']);
  assert.deepEqual(report.cases[1].omissions, ['b']);
  assert.equal(report.bySplit['held-out'].exactSetCorrect, 1);
  assert.equal(report.evidenceKind, 'synthetic');
  assert.equal(report.modelQualityMeasured, false);
});

test('unknown, refusal and error cannot earn correct empty classifications or zero-cost measurements', () => {
  const records = categories([['unknown', 'unknown'], ['unknown', 'unknown'], ['unknown', 'unknown']]);
  records[0] = receipt(category, 0, categoryRequest, [], { status: 'refusal', rawReply: { refusal: 'fixture' } });
  records[1] = receipt(category, 1, categoryRequest, [], { status: 'error', rawReply: { error: 'fixture' } });
  const report = scoreDecisions(category, categoryRequest, records);
  assert.equal(report.summary.exactSetCorrect, 0);
  assert.equal(report.summary.abstainedCases, 1);
  assert.equal(report.summary.unknownQuestions, 2);
  assert.equal(report.summary.failedCases, 2);
  assert.equal(report.summary.unassignedCases, 0);
  assert.equal(report.summary.refusals, 1);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.measurements.totalCostUsd, null);
  assert.equal(report.measurements.latencyP50Ms, null);
  assert.equal(report.measurements.knownCostCount, 0);
  assert.deepEqual(report.receipts[0].rawReply, { refusal: 'fixture' });
});

test('grounding reports critical false accepts and repairable rejections separately from syntax validity', () => {
  const report = scoreDecisions(grounding, groundingRequest, verdicts(['grounded', 'ungrounded', 'grounded']));
  assert.equal(report.summary.correct, 1);
  assert.equal(report.summary.falseAccepts, 1);
  assert.equal(report.summary.criticalFalseAccepts, 1);
  assert.equal(report.summary.repairableRejections, 1);
  assert.equal(report.summary.confusion.ungrounded.grounded, 1);
  assert.equal(report.summary.confusion.rewrite.ungrounded, 1);
});

test('grounding abstentions reduce coverage and all-case accuracy without inflating answered accuracy', () => {
  const report = scoreDecisions(grounding, groundingRequest, verdicts(['grounded', 'unknown', 'unknown']));
  assert.equal(report.summary.accuracy, 1 / 3);
  assert.equal(report.summary.answeredAccuracy, 1);
  assert.equal(report.summary.coverage, 1 / 3);
  assert.equal(report.summary.abstentions, 2);
});

test('failed grounding receipts remain separate from an explicit unknown decision', () => {
  const records = verdicts(['unknown', 'unknown', 'unknown']);
  records[0].status = 'error'; records[0].answers = [];
  records[1].status = 'refusal'; records[1].answers = [];
  const report = scoreDecisions(grounding, groundingRequest, records);
  assert.equal(report.summary.abstentions, 1);
  assert.equal(report.summary.failedCases, 2);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.refusals, 1);
  assert.equal(report.summary.coverage, 0);
  assert.equal(report.summary.accuracy, 0);
});

test('keyword observations must agree with their normalized positive tag decisions', () => {
  const records = categories([['applies', 'not_applicable'], ['not_applicable', 'applies'], ['not_applicable', 'not_applicable']]);
  for (const record of records) {
    record.evidenceKind = 'keyword-baseline';
    record.rawReply = { resource: { id: record.caseId, metadata: { canonicalId: record.caseId,
      taxonomyAssignments: record.answers.filter(a => a.choice === 'applies').map(a => ({ tagId: a.questionId })) } } };
  }
  const wrongObservation = structuredClone(records);
  wrongObservation[0].rawReply.resource.metadata.taxonomyAssignments = [{ tagId: 'b' }];
  assert.throws(() => scoreDecisions(category, categoryRequest, wrongObservation), /stored assignments/);
  assert.equal(scoreDecisions(category, categoryRequest, records).summary.exactSetCorrect, 3);
  const missingResource = structuredClone(records);
  missingResource[2].rawReply = null;
  assert.throws(() => scoreDecisions(category, categoryRequest, missingResource), /stored Resource/);
  const nullAssignments = structuredClone(records);
  nullAssignments[2].rawReply.resource.metadata.taxonomyAssignments = null;
  assert.throws(() => scoreDecisions(category, categoryRequest, nullAssignments), /stored assignments/);
  const absentAssignments = structuredClone(records);
  delete absentAssignments[2].rawReply.resource.metadata.taxonomyAssignments;
  assert.throws(() => scoreDecisions(category, categoryRequest, absentAssignments), /stored assignments/);
  const otherSource = structuredClone(records);
  otherSource[2].rawReply.resource.id = 'other-source';
  assert.throws(() => scoreDecisions(category, categoryRequest, otherSource), /another source/);
});

test('hashes bind exact request content and whole labels/rubric while ignoring JSON key order', () => {
  assert.equal(fingerprint({ a: 1, nested: { b: 2, a: 1 } }), fingerprint({ nested: { a: 1, b: 2 }, a: 1 }));
  const original = verdicts(['grounded', 'rewrite', 'ungrounded']);
  const changedLabels = structuredClone(grounding);
  changedLabels.cases[0].expected.verdict = 'rewrite';
  assert.throws(() => scoreDecisions(changedLabels, groundingRequest, original), /corpus hash/);
  assert.throws(() => scoreDecisions(grounding, () => ({ ...groundingRequest(), state: 'Changed source' }), original), /request hash/);
});

test('replay rejects duplicate or missing cases and questions, invalid choices and mixed model identities', () => {
  const records = verdicts(['grounded', 'rewrite', 'ungrounded']);
  assert.throws(() => scoreDecisions(grounding, groundingRequest, [...records, records[0]]), /duplicate case/);
  assert.throws(() => scoreDecisions(grounding, groundingRequest, records.slice(1)), /missing case/);
  for (const answers of [[], [{ questionId: 'verdict', choice: 'maybe' }],
    [{ questionId: 'verdict', choice: 'grounded' }, { questionId: 'verdict', choice: 'grounded' }]]) {
    const changed = structuredClone(records); changed[0].answers = answers;
    assert.throws(() => scoreDecisions(grounding, groundingRequest, changed), /question|choice/);
  }
  const mixed = structuredClone(records); mixed[0].resolvedModel = 'other-model';
  assert.throws(() => scoreDecisions(grounding, groundingRequest, mixed), /mixed model/);
});

test('measured cost and latency stay separate from unknown records and preserve reported usage', () => {
  const records = verdicts(['grounded', 'rewrite', 'ungrounded']);
  records[0].costUsd = 0.1; records[0].durationMs = 10; records[0].usage = { input_tokens: 9 };
  records[1].costUsd = 0.2; records[1].durationMs = 30;
  const report = scoreDecisions(grounding, groundingRequest, records);
  assert.equal(report.measurements.totalCostUsd, null);
  assert.ok(Math.abs(report.measurements.knownCostUsd - 0.3) < 1e-12);
  assert.equal(report.measurements.knownCostCount, 2);
  assert.equal(report.measurements.latencyP50Ms, 10);
  assert.equal(report.measurements.latencyP95Ms, 30);
  assert.equal(report.measurements.knownLatencyCount, 2);
  assert.deepEqual(report.receipts[0].usage, { input_tokens: 9 });
  assert.throws(() => scoreDecisions(grounding, groundingRequest, records.map((r, i) => i ? r : { ...r, costUsd: -1 })), /costUsd/);
});

test('a request omitting taxonomy questions cannot turn missing decisions into correct empty assignments', () => {
  const shortened = () => ({ state: 'Public source', questions: { a: categoryRequest().questions.a } });
  const records = category.cases.map((c, i) => receipt(category, i, shortened, [{ questionId: 'a', choice: 'not_applicable' }]));
  assert.throws(() => scoreDecisions(category, shortened, records), /task questions/);
});

test('duplicate expected tags cannot give exact-set credit to an extra wrong assignment', () => {
  const invalid = structuredClone(category);
  invalid.cases[0].expected.tags = ['a', 'a'];
  const records = invalid.cases.map((c, i) => receipt(invalid, i, categoryRequest,
    ['a', 'b'].map(questionId => ({ questionId, choice: i === 0 ? 'applies' : 'not_applicable' }))));
  assert.throws(() => scoreDecisions(invalid, categoryRequest, records), /duplicate expected tag/i);
});
