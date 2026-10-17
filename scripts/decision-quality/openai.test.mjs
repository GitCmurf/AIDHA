import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildCategoryRequest } from './category.mjs';
import { buildGroundingRequest } from './grounding.mjs';
import { OPENAI_ENDPOINT, buildOpenAIPayload, parseOpenAIReply } from './openai.mjs';

const request = {
  state: { source: { label: 'Public note', body: 'A short synthetic source.' } },
  questions: {
    incident: { type: 'choice', choices: ['applies', 'not_applicable', 'unknown'],
      instructions: 'Does incident response apply?', reviewer: 'do not send' },
    verdict: { type: 'choice', criteria: { grounded: 'Supported', rewrite: 'Repairable', ungrounded: 'Unsupported', unknown: 'Abstain' },
      instructions: 'Judge the evidence.' },
  },
  expected: { incident: 'not_applicable' },
};

test('translates choice arrays and criteria maps to the official named Decisions payload only', () => {
  assert.equal(OPENAI_ENDPOINT, 'https://api.openai.com/v1/decisions');
  assert.deepEqual(buildOpenAIPayload(request, 'gpt-6-luna'), {
    model: 'gpt-6-luna',
    input: JSON.stringify(request.state),
    questions: [
      { type: 'choice', name: 'incident', instructions: 'Does incident response apply?',
        choices: [
          { value: 'applies', description: 'The source substantively concerns the subject named in the question.' },
          { value: 'not_applicable', description: 'The source does not substantively concern the subject; negated or incidental mentions do not count.' },
          { value: 'unknown', description: 'The source does not provide enough context to decide reliably.' },
        ] },
      { type: 'choice', name: 'verdict', instructions: 'Judge the evidence.',
        choices: [{ value: 'grounded', description: 'Supported' }, { value: 'rewrite', description: 'Repairable' },
          { value: 'ungrounded', description: 'Unsupported' }, { value: 'unknown', description: 'Abstain' }] },
    ],
  });
});

test('rejects empty models, unsupported questions, or duplicate choices before translation', () => {
  assert.throws(() => buildOpenAIPayload(request, '  '), /model/i);
  const invalid = structuredClone(request);
  invalid.questions.incident.choices = ['applies', 'applies'];
  assert.throws(() => buildOpenAIPayload(invalid, 'gpt-6-luna'), /duplicate|unique/i);
  invalid.questions.incident.type = 'predicate';
  assert.throws(() => buildOpenAIPayload(invalid, 'gpt-6-luna'), /choice/i);
});

test('current category and grounding requests translate without sending corpus labels', async () => {
  const category = JSON.parse(await readFile(new URL('./category-cases.json', import.meta.url), 'utf8'));
  const grounding = JSON.parse(await readFile(new URL('./grounding-cases.json', import.meta.url), 'utf8'));
  for (const [testCase, normalized] of [
    [category.cases[0], buildCategoryRequest(category.cases[0], category.taxonomy)],
    [grounding.cases[0], buildGroundingRequest(grounding.cases[0])],
  ]) {
    const payload = buildOpenAIPayload(normalized, 'gpt-6-luna');
    assert.deepEqual(JSON.parse(payload.input), normalized.state);
    assert.deepEqual(payload.questions.map(item => item.name), Object.keys(normalized.questions));
    assert.ok(!JSON.stringify(payload).includes(testCase.expected.rationale));
    assert.ok(!JSON.stringify(payload).includes('"expected"'));
  }
});

test('arbitrary choice names do not inherit unintended descriptions', () => {
  const local = { state: { text: 'Synthetic' }, questions: { q: {
    type: 'choice', instructions: 'Choose one', choices: ['constructor', 'other'],
  } } };
  assert.deepEqual(buildOpenAIPayload(local, 'gpt-6-luna').questions[0].choices,
    [{ value: 'constructor' }, { value: 'other' }]);
});

const validReply = {
  model: 'gpt-6-luna',
  answers: [
    { type: 'choice', name: 'incident', choice: 'not_applicable', confidence: 0.91,
      probabilities: [
        { value: 'applies', probability: 0.04 },
        { value: 'not_applicable', probability: 0.91 },
        { value: 'unknown', probability: 0.05 },
      ] },
    { type: 'choice', name: 'verdict', choice: 'rewrite', confidence: 0.8,
      probabilities: [
        { value: 'grounded', probability: 0.1 }, { value: 'rewrite', probability: 0.8 },
        { value: 'ungrounded', probability: 0.05 }, { value: 'unknown', probability: 0.05 },
      ] },
  ],
  usage: { input_tokens: 42, output_tokens: 0, total_tokens: 42 },
};

test('a nullable error field does not reject an otherwise successful reply', () => {
  const reply = { ...validReply, error: null };
  assert.equal(parseOpenAIReply(reply, request).status, 'ok');
});

test('normalizes complete named choice answers and preserves actual model and usage without inventing cost', () => {
  assert.deepEqual(parseOpenAIReply(validReply, request), {
    status: 'ok',
    answers: [{ questionId: 'incident', choice: 'not_applicable' }, { questionId: 'verdict', choice: 'rewrite' }],
    resolvedModel: 'gpt-6-luna', usage: validReply.usage, costUsd: null,
  });
});

test('a per-question refusal is distinct from an explicit unknown answer', () => {
  const reply = structuredClone(validReply);
  reply.answers[1] = { type: 'refusal', name: 'verdict' };
  assert.deepEqual(parseOpenAIReply(reply, request), {
    status: 'refusal', answers: [{ questionId: 'incident', choice: 'not_applicable' }],
    resolvedModel: 'gpt-6-luna', usage: validReply.usage, costUsd: null,
  });
  reply.answers[0].choice = 'unknown';
  reply.answers[0].probabilities = undefined;
  assert.equal(parseOpenAIReply(reply, request).status, 'refusal');
});

test('malformed or incomplete named answers are errors, not fabricated unknown choices', () => {
  const badReplies = [];
  const missing = structuredClone(validReply); missing.answers.pop(); badReplies.push(missing);
  const extra = structuredClone(validReply); extra.answers.push({ type: 'choice', name: 'extra', choice: 'unknown' }); badReplies.push(extra);
  const duplicate = structuredClone(validReply); duplicate.answers[1].name = 'incident'; badReplies.push(duplicate);
  const wrongType = structuredClone(validReply); wrongType.answers[0].type = 'predicate'; badReplies.push(wrongType);
  const wrongChoice = structuredClone(validReply); wrongChoice.answers[0].choice = true; badReplies.push(wrongChoice);
  const absentModel = structuredClone(validReply); delete absentModel.model; badReplies.push(absentModel);
  for (const reply of badReplies) {
    const parsed = parseOpenAIReply(reply, request);
    assert.equal(parsed.status, 'error');
    assert.deepEqual(parsed.answers, []);
    assert.equal(parsed.costUsd, null);
    assert.ok(parsed.error);
  }
  assert.equal(parseOpenAIReply(badReplies.at(-1), request).resolvedModel, null);
});

test('probability and confidence fields, when supplied, must be finite, bounded and cover exactly the options', () => {
  for (const mutate of [
    answer => { answer.confidence = Number.NaN; },
    answer => { answer.confidence = 1.2; },
    answer => { answer.probabilities[0].probability = -0.1; },
    answer => { answer.probabilities.pop(); },
    answer => { answer.probabilities[0].value = 'other'; },
    answer => { answer.probabilities[0].probability = 0.5; },
  ]) {
    const reply = structuredClone(validReply);
    mutate(reply.answers[0]);
    assert.equal(parseOpenAIReply(reply, request).status, 'error');
  }
});

test('API error envelopes preserve observed identity and usage if present but never synthesize answers or cost', () => {
  const parsed = parseOpenAIReply({ error: { message: 'Rate limited' }, usage: { input_tokens: 5 } }, request);
  assert.equal(parsed.status, 'error');
  assert.deepEqual(parsed.answers, []);
  assert.equal(parsed.resolvedModel, null);
  assert.deepEqual(parsed.usage, { input_tokens: 5 });
  assert.equal(parsed.costUsd, null);
  assert.match(parsed.error, /Rate limited/);
});
