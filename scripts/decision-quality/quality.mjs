import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

function canonical(value) {
  if (value === null || typeof value !== 'object') {
    assert.ok(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'Expected finite JSON data');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function fingerprint(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

/** A receipt binds a normalized result to exact visible input and the frozen scoring rubric. */
export function stampReceipt(corpus, testCase, request, result) {
  return { ...result, task: corpus.task, caseId: testCase.id, corpusHash: fingerprint(corpus), requestHash: fingerprint(request) };
}

function checkReceipts(corpus, requestForCase, receipts) {
  assert.ok(['categorization', 'grounding'].includes(corpus.task), 'Unknown task');
  const cases = new Map(corpus.cases.map(c => [c.id, c]));
  assert.equal(cases.size, corpus.cases.length, 'Corpus has duplicate case IDs');
  assert.ok(cases.size > 0, 'Empty corpus');
  const checked = new Map();
  const identities = new Set();
  for (const receipt of receipts) {
    const testCase = cases.get(receipt.caseId);
    assert.ok(testCase, `Unknown case ${receipt.caseId}`);
    assert.ok(!checked.has(receipt.caseId), `duplicate case ${receipt.caseId}`);
    assert.equal(receipt.task, corpus.task, 'Receipt task mismatch');
    assert.equal(receipt.corpusHash, fingerprint(corpus), 'Receipt corpus hash mismatch');
    const request = requestForCase(testCase);
    assert.equal(receipt.requestHash, fingerprint(request), 'Receipt request hash mismatch');
    for (const field of ['requestedModel', 'resolvedModel']) assert.ok(typeof receipt[field] === 'string' && receipt[field].trim(), `Missing ${field}`);
    assert.ok(receipt.endpoint === null || (typeof receipt.endpoint === 'string' && receipt.endpoint.trim()), 'Missing endpoint or explicit null');
    assert.ok(['synthetic', 'keyword-baseline', 'recorded-provider'].includes(receipt.evidenceKind), 'Unknown evidenceKind');
    assert.ok(['ok', 'refusal', 'error'].includes(receipt.status), 'Unknown receipt status');
    assert.ok(receipt.rawReply !== undefined, 'Missing raw reply (use explicit null if unavailable)');
    for (const field of ['costUsd', 'durationMs']) {
      assert.ok(receipt[field] === null || (typeof receipt[field] === 'number' && Number.isFinite(receipt[field]) && receipt[field] >= 0), `Invalid ${field}; use null for unknown`);
    }
    assert.ok(receipt.usage !== undefined, 'Missing usage (use explicit null if unknown)');
    assert.ok(Array.isArray(receipt.answers), 'Missing normalized answers');
    const questions = request.questions;
    assert.ok(questions && Object.keys(questions).length, 'Missing questions');
    const taskQuestions = corpus.task === 'categorization' ? corpus.taxonomy.tags.map(t => t.id) : ['verdict'];
    assert.deepEqual(Object.keys(questions).sort(), [...taskQuestions].sort(), 'Request does not contain the task questions');
    const answers = new Map();
    for (const answer of receipt.answers) {
      assert.ok(Object.hasOwn(questions, answer.questionId), `Unknown question ${answer.questionId}`);
      assert.ok(!answers.has(answer.questionId), `Duplicate question ${answer.questionId}`);
      const question = questions[answer.questionId];
      const choices = question.choices ?? Object.keys(question.criteria ?? {});
      assert.ok(choices.includes(answer.choice), `Invalid choice ${answer.choice}`);
      answers.set(answer.questionId, answer.choice);
    }
    if (receipt.status === 'ok') assert.equal(answers.size, Object.keys(questions).length, 'Missing question answer');
    if (receipt.evidenceKind === 'keyword-baseline') {
      assert.equal(corpus.task, 'categorization', 'Keyword baseline must be a category task');
      assert.equal(receipt.status, 'ok', 'Keyword baseline needs completed stored observations');
      const resource = receipt.rawReply?.resource;
      assert.ok(resource && typeof resource.id === 'string' && resource.id.trim() &&
        resource.metadata && typeof resource.metadata === 'object' && !Array.isArray(resource.metadata),
      'Missing stored Resource observation');
      if (testCase.source?.canonicalId) {
        assert.equal(resource.id, testCase.source.canonicalId, 'Stored Resource belongs to another source');
        assert.equal(resource.metadata.canonicalId, testCase.source.canonicalId, 'Stored Resource canonical source mismatch');
      }
      const stored = resource.metadata.taxonomyAssignments;
      assert.ok(Array.isArray(stored), 'Invalid stored assignments');
      assert.deepEqual(stored.map(a => a.tagId).sort(),
        [...answers].filter(([, choice]) => choice === 'applies').map(([id]) => id).sort(),
        'Normalized answers disagree with stored assignments');
    }
    identities.add(JSON.stringify([receipt.requestedModel, receipt.resolvedModel, receipt.endpoint, receipt.evidenceKind]));
    checked.set(receipt.caseId, { receipt, answers });
  }
  for (const id of cases.keys()) assert.ok(checked.has(id), `missing case ${id}`);
  assert.equal(identities.size, 1, 'Cannot score mixed model identities, endpoints or evidence kinds');
  return checked;
}

const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const countStatus = (rows, status) => rows.filter(r => r.status === status).length;

function categorySummary(rows, tagIds) {
  const perTag = Object.fromEntries(tagIds.map(tag => {
    const truePositives = rows.filter(r => r.expectedTags.includes(tag) && r.assignedTags.includes(tag)).length;
    const falsePositives = rows.filter(r => !r.expectedTags.includes(tag) && r.assignedTags.includes(tag)).length;
    // A positive label without a positive decision is a missed assignment, including abstentions.
    const falseNegatives = rows.filter(r => r.expectedTags.includes(tag) && !r.assignedTags.includes(tag)).length;
    return [tag, { truePositives, falsePositives, falseNegatives,
      precision: ratio(truePositives, truePositives + falsePositives), recall: ratio(truePositives, truePositives + falseNegatives) }];
  }));
  const micro = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  for (const counts of Object.values(perTag)) for (const field of Object.keys(micro)) micro[field] += counts[field];
  const exactSetCorrect = rows.filter(r => r.correct).length;
  return { total: rows.length, exactSetCorrect, exactSetAccuracy: ratio(exactSetCorrect, rows.length), perTag,
    micro: { ...micro, precision: ratio(micro.truePositives, micro.truePositives + micro.falsePositives),
      recall: ratio(micro.truePositives, micro.truePositives + micro.falseNegatives) },
    abstainedCases: rows.filter(r => r.status === 'ok' && r.unknownTags.length).length,
    failedCases: rows.filter(r => r.status !== 'ok').length,
    unknownQuestions: rows.reduce((n, r) => n + r.unknownTags.length, 0),
    unassignedCases: rows.filter(r => r.status === 'ok' && !r.unknownTags.length && !r.assignedTags.length).length,
    refusals: countStatus(rows, 'refusal'), errors: countStatus(rows, 'error') };
}

function groundingSummary(rows) {
  const verdicts = ['grounded', 'rewrite', 'ungrounded'];
  const columns = [...verdicts, 'unknown', 'refusal', 'error'];
  const confusion = Object.fromEntries(verdicts.map(v => [v, Object.fromEntries(columns.map(c => [c, 0]))]));
  for (const row of rows) confusion[row.expected][row.predicted]++;
  const correct = rows.filter(r => r.expected === r.predicted).length;
  const answered = rows.filter(r => verdicts.includes(r.predicted)).length;
  const falseAcceptRows = rows.filter(r => r.expected !== 'grounded' && r.predicted === 'grounded');
  return { total: rows.length, correct, accuracy: ratio(correct, rows.length), answered,
    answeredAccuracy: ratio(correct, answered), coverage: ratio(answered, rows.length),
    abstentions: rows.filter(r => r.predicted === 'unknown').length,
    failedCases: rows.filter(r => r.status !== 'ok').length,
    refusals: countStatus(rows, 'refusal'), errors: countStatus(rows, 'error'),
    falseAccepts: falseAcceptRows.length,
    criticalFalseAccepts: falseAcceptRows.filter(r => r.criticalFalseAccept).length,
    repairableRejections: rows.filter(r => r.expected === 'rewrite' && r.predicted === 'ungrounded').length,
    supportedRejections: rows.filter(r => r.expected === 'grounded' && r.predicted === 'ungrounded').length,
    confusion };
}

function measurements(receipts) {
  const costs = receipts.filter(r => r.costUsd !== null).map(r => r.costUsd);
  const times = receipts.filter(r => r.durationMs !== null).map(r => r.durationMs).sort((a, b) => a - b);
  const knownCostUsd = costs.reduce((n, c) => n + c, 0);
  // Nearest-rank percentiles, restricted to the explicitly recorded sample.
  const percentile = p => times.length ? times[Math.ceil(p * times.length) - 1] : null;
  return { knownCostCount: costs.length, knownCostUsd: costs.length ? knownCostUsd : null,
    totalCostUsd: costs.length === receipts.length ? knownCostUsd : null,
    knownLatencyCount: times.length, latencyP50Ms: percentile(0.5), latencyP95Ms: percentile(0.95) };
}

export function scoreDecisions(corpus, requestForCase, receipts) {
  const checked = checkReceipts(corpus, requestForCase, receipts);
  let cases;
  let summarize;
  if (corpus.task === 'categorization') {
    const tagIds = corpus.taxonomy.tags.map(t => t.id);
    assert.equal(new Set(tagIds).size, tagIds.length, 'Duplicate taxonomy tag');
    cases = corpus.cases.map(c => {
      assert.ok(c.expected.tags.every(t => tagIds.includes(t)), 'Unknown expected tag');
      assert.equal(new Set(c.expected.tags).size, c.expected.tags.length, 'duplicate expected tag');
      const { receipt, answers } = checked.get(c.id);
      const assignedTags = receipt.status === 'ok' ? tagIds.filter(t => answers.get(t) === 'applies') : [];
      const unknownTags = receipt.status === 'ok' ? tagIds.filter(t => answers.get(t) === 'unknown') : [];
      return { caseId: c.id, split: c.split, status: receipt.status, expectedTags: c.expected.tags, assignedTags, unknownTags,
        correct: receipt.status === 'ok' && !unknownTags.length && sameSet(c.expected.tags, assignedTags),
        wrongAssignments: assignedTags.filter(t => !c.expected.tags.includes(t)),
        omissions: c.expected.tags.filter(t => !assignedTags.includes(t)) };
    });
    summarize = rows => categorySummary(rows, tagIds);
  } else {
    cases = corpus.cases.map(c => {
      assert.ok(['grounded', 'rewrite', 'ungrounded'].includes(c.expected.verdict), 'Unknown expected verdict');
      const { receipt, answers } = checked.get(c.id);
      return { caseId: c.id, split: c.split, status: receipt.status, expected: c.expected.verdict,
        predicted: receipt.status === 'ok' ? answers.get('verdict') : receipt.status,
        criticalFalseAccept: c.expected.criticalFalseAccept === true };
    });
    summarize = groundingSummary;
  }
  const first = receipts[0];
  return { version: 1, task: corpus.task, corpusHash: fingerprint(corpus), labelStatus: corpus.labelStatus,
    requestedModel: first.requestedModel, resolvedModel: first.resolvedModel, endpoint: first.endpoint,
    evidenceKind: first.evidenceKind, modelQualityMeasured: first.evidenceKind === 'recorded-provider',
    summary: summarize(cases), bySplit: Object.fromEntries([...new Set(cases.map(c => c.split))].map(split =>
      [split, summarize(cases.filter(c => c.split === split))])),
    measurements: measurements(receipts), cases, receipts };
}
