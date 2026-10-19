import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSemanticCase } from './run.mjs';

const source = 'For collections with fewer than a hundred pages, maintain a short index of explicit links. This recommendation is intended to reduce navigation effort. The demonstration opens a menu and clicks a button, which is merely interface setup.';
const testCase = { id: 'test-index', title: 'Synthetic index guidance', excerpts: [{ id: 'ex1', text: source }],
  expected: [{ id: 'NEVER_SEND_EXPECTATIONS_TO_MODEL', proposition: 'Reviewer-only expected meaning' }] };
const proposal = { schemaVersion: 1, sourceType: 'tutorial', sourceCoherence: 'single_topic', theses: [], units: [{
  id: 'u1', kind: 'recommendation', text: 'Maintain a short index of explicit links for collections with fewer than a hundred pages.',
  rationale: 'To reduce navigation effort.', conditions: [{ type: 'scale', text: 'collections with fewer than a hundred pages' }],
  importance: 'core', stance: 'recommended', evidence: [{ excerptId: 'ex1', quote: 'maintain a short index of explicit links' }],
}] };

test('runs the actual miner and exporter without leaking expectations, retaining persisted qualified evidence', async () => {
  const requests = [];
  const llm = { async generate(request) {
    requests.push(request);
    assert.ok(!request.user.includes('NEVER_SEND_EXPECTATIONS_TO_MODEL'));
    assert.ok(!request.system.includes('NEVER_SEND_EXPECTATIONS_TO_MODEL'));
    return { ok: true, value: JSON.stringify(requests.length === 1 ? proposal : { verdicts: [{ unitId: 'u1', verdict: 'grounded' }] }),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
  } };
  const actual = await runSemanticCase({ testCase, llm, model: 'synthetic-model' });
  assert.equal(requests.length, 2);
  assert.equal(actual.report.sourceDistillation.failedClosed, false);
  assert.equal(actual.report.claimsExtracted, 1);
  assert.equal(actual.persistedClaims.length, 1);
  const stored = actual.persistedClaims[0];
  assert.equal(stored.content, proposal.units[0].text);
  assert.equal(stored.metadata.trusted, false);
  assert.deepEqual(stored.metadata.conditions, proposal.units[0].conditions);
  assert.deepEqual(stored.metadata.evidence, [{ ...proposal.units[0].evidence[0], quoteVerification: 'exact' }]);
  assert.deepEqual(actual.expectations, testCase.expected);
});

test('persists partial call evidence before rethrowing an uncaught runtime failure', async () => {
  const { recordCase } = await import('./record-case.mjs');
  const calls = [{ request: { user: 'Public synthetic source' } }];
  const failure = new Error('Synthetic export failure');
  let saved;
  await assert.rejects(recordCase({ caseId: 'failed-case', calls, provenance: { model: 'synthetic' },
    run: async () => { throw failure; }, save: async record => { saved = record; } }), error => error === failure);
  assert.equal(saved.caseId, 'failed-case');
  assert.equal(saved.error, 'Synthetic export failure');
  assert.deepEqual(saved.calls, calls);
  assert.equal(saved.model, 'synthetic');
  assert.equal(saved.report, undefined);
});
