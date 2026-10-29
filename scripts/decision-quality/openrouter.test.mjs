import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOpenRouterPayload, parseOpenRouterReply, OPENROUTER_ENDPOINT } from './openrouter.mjs';

const categoryRequest = { state: { source: { label: 'Synthetic note', body: 'A release plan describes staged rollout.' } },
  questions: { release: { type: 'choice', choices: ['applies', 'not_applicable', 'unknown'],
    instructions: 'Does the source substantively concern release management?' } },
  expected: { tags: ['release'] }, split: 'held-out' };
const groundingRequest = { state: { source: { title: 'Synthetic record' }, unit: { text: 'A reported result.' } },
  questions: { verdict: { type: 'choice', instructions: 'Judge the unit against cited evidence.', criteria: {
    grounded: 'Supported as written.', rewrite: 'Same core can be repaired.',
    ungrounded: 'Core unsupported.', unknown: 'Insufficient evidence.',
  } } } };

test('translates current category and grounding choices to the official state/questions shape', () => {
  assert.equal(OPENROUTER_ENDPOINT, 'https://openrouter.ai/api/alpha/decisions');
  const category = buildOpenRouterPayload(categoryRequest, 'typesafe/jev-1.14');
  assert.deepEqual(Object.keys(category), ['model', 'state', 'questions']);
  assert.equal(category.model, 'typesafe/jev-1.14');
  assert.deepEqual(category.state, categoryRequest.state);
  assert.deepEqual(category.questions.release.criteria, {
    applies: 'The source substantively concerns the subject named in the question.',
    not_applicable: 'The source does not substantively concern the subject; negated or incidental mentions do not count.',
    unknown: 'The source does not provide enough context to decide reliably.',
  });
  assert.equal(category.questions.release.instructions, categoryRequest.questions.release.instructions);
  assert.ok(!JSON.stringify(category).includes('held-out'));
  assert.ok(!JSON.stringify(category).includes('"expected"'));
  const grounding = buildOpenRouterPayload(groundingRequest, 'typesafe/jev-1.14');
  assert.deepEqual(grounding.questions.verdict, groundingRequest.questions.verdict);
});

test('parses complete typed choice replies and preserves resolved model, usage, and billed cost', () => {
  const request = { ...categoryRequest, questions: {
    ...categoryRequest.questions,
    capacity: { ...categoryRequest.questions.release, instructions: 'Does the source concern capacity?' },
  } };
  const raw = { model: 'typesafe/jev-1.14-20261014', usage: { input_tokens: 357, output_tokens: 38, cost: 0.000014994 },
    answers: {
      release: { type: 'choice', choice: 'applies', probabilities: { applies: 0.9, not_applicable: 0.08, unknown: 0.02 }, confidence: 0.82 },
      capacity: { type: 'choice', choice: 'not_applicable', probabilities: { applies: 0.01, not_applicable: 0.99, unknown: 0 }, confidence: 0.99 },
    } };
  assert.deepEqual(parseOpenRouterReply(raw, request), {
    status: 'ok', answers: [{ questionId: 'release', choice: 'applies' }, { questionId: 'capacity', choice: 'not_applicable' }],
    resolvedModel: raw.model, usage: raw.usage, costUsd: raw.usage.cost,
  });
  const grounded = { model: 'typesafe/jev-1.14-20261014', answers: {
    verdict: { type: 'choice', choice: 'rewrite', probabilities: { grounded: 0.01, rewrite: 0.98, ungrounded: 0.01, unknown: 0 }, confidence: 0.96 },
  } };
  assert.deepEqual(parseOpenRouterReply(grounded, groundingRequest), {
    status: 'ok', answers: [{ questionId: 'verdict', choice: 'rewrite' }],
    resolvedModel: grounded.model, usage: null, costUsd: null,
  });
});

test('rejects missing, extra, or invalid typed answers without inventing unknown choices', () => {
  const valid = { model: 'served-v1', usage: { cost: 0.002, input_tokens: 50 }, answers: {
    release: { type: 'choice', choice: 'applies', probabilities: { applies: 0.8, not_applicable: 0.1, unknown: 0.1 }, confidence: 0.7 },
  } };
  for (const changed of [
    { ...valid, answers: {} },
    { ...valid, answers: { ...valid.answers, extra: valid.answers.release } },
    { ...valid, answers: { release: { ...valid.answers.release, type: 'noul' } } },
    { ...valid, answers: { release: { ...valid.answers.release, choice: 'other' } } },
    { ...valid, answers: { release: { ...valid.answers.release, confidence: 1.1 } } },
    { ...valid, answers: { release: { ...valid.answers.release, probabilities: { applies: 0.8, not_applicable: 0.1, unknown: Number.NaN } } } },
    { ...valid, answers: { release: { ...valid.answers.release, probabilities: { applies: 0.4, not_applicable: 0.1, unknown: 0.1 } } } },
    { ...valid, answers: { release: { ...valid.answers.release, probabilities: { applies: 0.8, not_applicable: 0.1, surprise: 0.1 } } } },
  ]) {
    const result = parseOpenRouterReply(changed, categoryRequest);
    assert.equal(result.status, 'error');
    assert.deepEqual(result.answers, []);
    assert.equal(result.resolvedModel, 'served-v1');
    assert.deepEqual(result.usage, valid.usage);
    assert.equal(result.costUsd, 0.002);
  }
});

test('keeps explicit refusals, provider errors, and malformed replies distinct from unknown answers', () => {
  const refused = parseOpenRouterReply({ model: 'served-v1', refusal: { message: 'Declined' }, usage: { cost: 0 } }, categoryRequest);
  assert.equal(refused.status, 'refusal');
  assert.deepEqual(refused.answers, []);
  assert.equal(refused.costUsd, 0);
  const providerError = parseOpenRouterReply({ error: { code: 429, message: 'Rate limit exceeded' } }, categoryRequest);
  assert.equal(providerError.status, 'error');
  assert.match(providerError.error, /Rate limit/);
  assert.equal(providerError.resolvedModel, null);
  for (const raw of [null, 'not-json', { model: 'served-v1', answers: null }, { answers: { release: { type: 'choice', choice: 'unknown' } } }]) {
    const result = parseOpenRouterReply(raw, categoryRequest);
    assert.equal(result.status, 'error');
    assert.deepEqual(result.answers, []);
  }
});

test('rejects incomplete request shapes before constructing a payload', () => {
  for (const model of ['', '   ', null]) assert.throws(() => buildOpenRouterPayload(categoryRequest, model), /model/);
  assert.throws(() => buildOpenRouterPayload({ state: {}, questions: {} }, 'model'), /questions/);
  assert.throws(() => buildOpenRouterPayload({ ...categoryRequest, questions: {
    release: { ...categoryRequest.questions.release, choices: ['applies', 'unknown'] },
  } }, 'model'), /choice array/);
  assert.throws(() => buildOpenRouterPayload({ ...groundingRequest, questions: {
    verdict: { ...groundingRequest.questions.verdict, criteria: { grounded: 'Supported', rewrite: '' } },
  } }, 'model'), /criteria/);
});
