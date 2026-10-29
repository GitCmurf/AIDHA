import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCorpora } from './run.mjs';
import { prepareDecisionPlan } from './plan.mjs';
import { fingerprint } from './quality.mjs';

test('prepares a bounded three-model comparison without confusing questions with HTTP calls', async () => {
  const plan = prepareDecisionPlan(await loadCorpora());
  assert.equal(plan.executionAllowed, false);
  assert.equal(plan.models.length, 3);
  assert.deepEqual(plan.counts, { smokeCalls: 6, comparisonCalls: 288, maximumCalls: 294,
    smokeQuestions: 18, comparisonQuestions: 864, maximumQuestions: 882 });
  assert.equal(plan.repeats, 3);
  assert.equal(plan.maxAttemptsPerCall, 1);
  assert.equal(plan.requests.length, 96);
  assert.equal(plan.models.filter(m => m.provider === 'openrouter').length, 2);
  assert.equal(plan.models.filter(m => m.provider === 'openai').length, 1);
});

test('freezes each native payload separately from normalized task input and excludes reviewer labels', async () => {
  const corpora = await loadCorpora();
  const plan = prepareDecisionPlan(corpora);
  for (const item of plan.requests) {
    assert.equal(item.nativePayloadHash, fingerprint(item.payload));
    assert.equal(item.payloadBytes, Buffer.byteLength(JSON.stringify(item.payload)));
    const testCase = corpora[item.task].cases.find(c => c.id === item.caseId);
    const text = JSON.stringify(item.payload);
    assert.ok(!text.includes(testCase.expected.rationale));
    assert.ok(!Object.hasOwn(item.payload, 'caseId'));
    assert.ok(!Object.hasOwn(item.payload, 'split'));
    assert.ok(!Object.hasOwn(item.payload, 'expected'));
    assert.equal(item.questionCount, item.task === 'grounding' ? 1 : 5);
  }
  assert.equal(plan.billing.hardBillingCap, false);
  assert.equal(plan.billing.estimatedTotalUsd, null);
  assert.equal(plan.requests.filter(r => r.smoke).length, 6);
});
