import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildGroundingRequest, validateGroundingCase } from './grounding.mjs';

const corpus = JSON.parse(await readFile(new URL('./grounding-cases.json', import.meta.url), 'utf8'));

test('all public cases have valid source-bound literal evidence and balanced frozen labels', () => {
  assert.equal(corpus.version, 1);
  assert.equal(corpus.task, 'grounding');
  assert.equal(corpus.labelStatus, 'assistant-authored; not human gold');
  assert.equal(corpus.cases.length, 16);
  assert.equal(new Set(corpus.cases.map(item => item.id)).size, 16);
  assert.equal(corpus.cases.filter(item => item.split === 'development').length, 8);
  assert.equal(corpus.cases.filter(item => item.split === 'held-out').length, 8);
  assert.deepEqual(new Set(corpus.cases.map(item => item.expected.verdict)), new Set(['grounded', 'rewrite', 'ungrounded']));
  for (const item of corpus.cases) {
    assert.equal(validateGroundingCase(item), true, item.id);
    assert.equal(typeof item.expected.criticalFalseAccept, 'boolean', item.id);
    assert.ok(item.expected.rationale.length > 15, item.id);
    assert.match(item.source.id, /^src-\d{2}$/);
    assert.equal(item.unit.id, 'u1');
    assert.ok(item.excerpts.every((excerpt, index) => excerpt.id === `e${index + 1}`));
  }
});

test('request includes all source excerpts and unit fields but excludes frozen labels', () => {
  for (const item of corpus.cases) {
    const request = buildGroundingRequest(item);
    assert.deepEqual(request.state, {
      source: { id: item.source.id, title: item.source.title },
      excerpts: item.excerpts.map(({ id, text }) => ({ id, text })),
      unit: item.unit,
    });
    assert.deepEqual(Object.keys(request.questions), ['verdict']);
    assert.equal(request.questions.verdict.type, 'choice');
    assert.deepEqual(Object.keys(request.questions.verdict.criteria), ['grounded', 'rewrite', 'ungrounded', 'unknown']);
    const wire = JSON.stringify(request);
    assert.ok(!wire.includes(item.expected.rationale), item.id);
    assert.ok(!wire.includes('"expected"'), item.id);
    assert.ok(!wire.includes('held-out'), item.id);
    assert.ok(!wire.includes('development'), item.id);
  }
});

test('nested annotations cannot enter the model request while genuine unit qualifiers survive', () => {
  const item = structuredClone(corpus.cases.find(entry => entry.id === 'speaker-origin'));
  item.source.expected = { verdict: 'rewrite' };
  item.source.reviewer = 'secret source note';
  item.excerpts[0].expected = { verdict: 'rewrite' };
  item.excerpts[0].reviewer = 'secret excerpt note';
  item.unit.expected = { verdict: 'rewrite' };
  item.unit.reviewer = 'secret unit note';
  item.unit.evidence[0].reviewer = 'secret evidence note';
  item.unit.rationale = 'The speaker proposed a check after heavy rain.';
  item.unit.conditions = [{ type: 'temporal', text: 'After heavy rain' }];

  const { state } = buildGroundingRequest(item);
  assert.deepEqual(state.source, { id: item.source.id, title: item.source.title });
  assert.deepEqual(state.excerpts, [{ id: 'e1', text: item.excerpts[0].text }]);
  assert.equal(state.unit.rationale, item.unit.rationale);
  assert.deepEqual(state.unit.conditions, item.unit.conditions);
  assert.deepEqual(state.unit.attribution, item.unit.attribution);
  assert.deepEqual(state.unit.evidence, [{ excerptId: 'e1', quote: item.unit.evidence[0].quote }]);
  assert.ok(!JSON.stringify(state).includes('secret'));
  assert.ok(!JSON.stringify(state).includes('expected'));
  assert.ok(!JSON.stringify(state).includes('reviewer'));
});

test('verdict rubric treats a preserved core observation with wrong method or origin as repairable', () => {
  const { criteria } = buildGroundingRequest(corpus.cases.find(item => item.id === 'trial-origin')).questions.verdict;
  assert.match(criteria.rewrite, /core observation/i);
  assert.match(criteria.rewrite, /method/i);
  assert.match(criteria.rewrite, /attribution/i);
  assert.match(criteria.rewrite, /priority/i);
  assert.match(criteria.ungrounded, /central event.*outcome.*mechanism/i);
  assert.match(criteria.ungrounded, /replace the substantive claim/i);
});

test('nonliteral quotation is rejected by the production evidence verifier', () => {
  const item = structuredClone(corpus.cases[0]);
  item.unit.evidence[0].quote = 'This invented quotation never appeared in the source';
  assert.throws(() => validateGroundingCase(item), /literal|quote|evidence/i);
  assert.throws(() => buildGroundingRequest(item), /literal|quote|evidence/i);
});
