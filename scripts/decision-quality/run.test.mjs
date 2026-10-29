import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { collectKeywordBaseline, loadCorpora, prepareRequests, runCli } from './run.mjs';
import { stampReceipt } from './quality.mjs';
import { scoreDecisions } from './quality.mjs';
import { buildCategoryRequest } from './category.mjs';
import { buildGroundingRequest } from './grounding.mjs';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Offline receipt collection network call'); }; });
after(() => { globalThis.fetch = originalFetch; });

test('collects actual persisted keyword decisions and computes a truthful source-only baseline', async () => {
  const corpus = (await loadCorpora()).categorization;
  const report = await collectKeywordBaseline(corpus);
  assert.equal(report.summary.total, 16);
  assert.equal(report.evidenceKind, 'keyword-baseline');
  assert.equal(report.modelQualityMeasured, false);
  assert.match(report.resolvedModel, /^praecis-keyword-classifier@sha256:[a-f0-9]{64}$/);
  for (const record of report.receipts) {
    const stored = record.rawReply.resource.metadata.taxonomyAssignments;
    assert.ok(Array.isArray(stored));
    assert.equal(record.rawReply.classification.status, 'completed');
    assert.equal(record.rawReply.taxonomyVersionVerified, true);
    assert.deepEqual(record.answers.filter(a => a.choice === 'applies').map(a => a.questionId).sort(), stored.map(a => a.tagId).sort());
    assert.equal(record.costUsd, null);
  }
  // Tool correctness stays valid if the classifier later improves.
  assert.equal(report.summary.exactSetCorrect, report.cases.filter(c => c.correct).length);
});

test('published baseline receipts still bind to the current frozen corpus and requests', async () => {
  const corpus = (await loadCorpora()).categorization;
  const saved = JSON.parse(await readFile(new URL('./keyword-baseline.json', import.meta.url), 'utf8'));
  const replay = scoreDecisions(corpus, c => buildCategoryRequest(c, corpus.taxonomy), saved.receipts);
  assert.deepEqual(replay.summary, saved.summary);
  assert.deepEqual(replay.bySplit, saved.bySplit);
  assert.equal(replay.corpusHash, saved.corpusHash);
  assert.deepEqual(replay.cases, saved.cases);
  const fresh = await collectKeywordBaseline(corpus);
  // Historical evidence may remain when the classifier changes; do not pin known bad behavior.
  if (fresh.resolvedModel === saved.resolvedModel) assert.deepEqual(fresh, saved);
  else console.log('Published keyword baseline is historical: compiled classifier identity differs.');
});

test('exports both task packets without sending expected answers or split metadata', async () => {
  const corpora = await loadCorpora();
  const packet = prepareRequests(corpora);
  assert.equal(packet.tasks.categorization.requests.length, 16);
  assert.equal(packet.tasks.grounding.requests.length, 16);
  for (const [task, value] of Object.entries(packet.tasks)) for (const item of value.requests) {
    const testCase = corpora[task].cases.find(c => c.id === item.caseId);
    assert.ok(!JSON.stringify(item.request).includes(testCase.expected.rationale));
    assert.ok(!Object.hasOwn(item.request, 'expected'));
    assert.ok(!Object.hasOwn(item.request, 'split'));
    assert.match(item.requestHash, /^sha256:/);
  }
});

test('CLI preserves output files and replays normalized evidence receipts without invoking a provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-decision-'));
  try {
    const requestsPath = join(directory, 'requests.json');
    await runCli(['--requests', requestsPath]);
    await assert.rejects(runCli(['--requests', requestsPath]), /EEXIST/);
    const original = await readFile(requestsPath, 'utf8');
    assert.equal(JSON.parse(original).tasks.grounding.requests.length, 16);
    const corpus = (await loadCorpora()).grounding;
    const receipts = corpus.cases.map((c, i) => stampReceipt(corpus, c, buildGroundingRequest(c), {
      requestedModel: 'fixture', resolvedModel: 'fixture-v1', endpoint: null, evidenceKind: 'synthetic',
      status: 'ok', answers: [{ questionId: 'verdict', choice: i % 2 ? 'unknown' : 'grounded' }],
      rawReply: { fixture: true }, usage: null, costUsd: null, durationMs: null,
    }));
    const receiptsPath = join(directory, 'receipts.json');
    const reportPath = join(directory, 'report.json');
    await writeFile(receiptsPath, JSON.stringify(receipts));
    await runCli(['--replay', 'grounding', receiptsPath, reportPath]);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.summary.total, 16);
    assert.equal(report.summary.abstentions, 8);
    assert.equal(report.modelQualityMeasured, false);
    assert.equal(report.measurements.totalCostUsd, null);
    assert.equal(await readFile(requestsPath, 'utf8'), original);
    await assert.rejects(runCli(['--replay', 'unknown-task', receiptsPath, reportPath]), /task/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
