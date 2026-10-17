import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildCategoryRequest, runKeywordBaseline } from './category.mjs';

const corpus = JSON.parse(await readFile(new URL('./category-cases.json', import.meta.url), 'utf8'));
const byId = id => corpus.cases.find(value => value.id === id);

test('freezes sixteen public category cases with valid taxonomy labels and two splits', () => {
  assert.equal(corpus.version, 1);
  assert.equal(corpus.task, 'categorization');
  assert.equal(corpus.labelStatus, 'assistant-authored; not human gold');
  assert.equal(corpus.cases.length, 16);
  assert.equal(new Set(corpus.cases.map(value => value.id)).size, 16);
  assert.equal(corpus.cases.filter(value => value.split === 'development').length, 8);
  assert.equal(corpus.cases.filter(value => value.split === 'held-out').length, 8);
  const knownTags = new Set(corpus.taxonomy.tags.map(value => value.id));
  for (const value of corpus.cases) {
    assert.equal(value.source.sourceType, 'web');
    assert.match(value.source.canonicalId, /^synthetic:category:/);
    assert.ok(value.source.body.length > 70);
    assert.ok(value.expected.tags.every(id => knownTags.has(id)));
  }
});

test('builds source-only choice requests without exposing expected labels or splits', () => {
  const testCase = byId('cat09');
  const request = buildCategoryRequest(testCase, corpus.taxonomy);
  assert.deepEqual(request.state.source, { label: testCase.source.label, body: testCase.source.body });
  assert.equal(Object.keys(request.questions).length, corpus.taxonomy.tags.length);
  assert.deepEqual(request.questions.incident.choices, ['applies', 'not_applicable', 'unknown']);
  assert.doesNotMatch(JSON.stringify(request), /assistant-authored|held-out|rationale|expected|synthetic:category:09/);
  assert.ok(!Object.hasOwn(request.state, 'split'));
  for (const value of corpus.cases) {
    const visible = buildCategoryRequest(value, corpus.taxonomy);
    assert.deepEqual(visible.state.source, { label: value.source.label, body: value.source.body });
    assert.ok(!Object.hasOwn(visible.state.source, 'canonicalId'));
    assert.ok(!Object.hasOwn(visible, 'expected'));
    assert.ok(!Object.hasOwn(visible, 'split'));
    assert.ok(!Object.hasOwn(visible, 'rationale'));
  }
});

test('runs the keyword classifier through runtime and reads persisted graph assignments', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Offline baseline must not use network'); };
  try {
    const results = await runKeywordBaseline(corpus);
    assert.equal(results.length, 16);
    assert.deepEqual(results.map(value => value.caseId), corpus.cases.map(value => value.id));
    const knownTags = new Set(corpus.taxonomy.tags.map(value => value.id));
    for (const value of results) {
      assert.ok(value.assignedTags.every(tagId => knownTags.has(tagId)));
      assert.deepEqual((value.resource.metadata.taxonomyAssignments ?? []).map(row => row.tagId).sort(), value.assignedTags);
      assert.deepEqual(value.request, buildCategoryRequest(byId(value.caseId), corpus.taxonomy));
      assert.ok((value.resource.metadata.taxonomyAssignments ?? []).every(row =>
        row.assignedBy === 'praecis-keyword-classifier' && row.assignedAt === '2026-10-17T00:00:00.000Z'));
    }
    const multi = results.find(value => value.caseId === 'cat06');
    assert.deepEqual(multi.assignedTags, ['capacity', 'incident']);
    const currentMistakes = results.filter(value => JSON.stringify(value.assignedTags) !==
      JSON.stringify([...byId(value.caseId).expected.tags].sort())).map(value => value.caseId);
    console.log(`Observed keyword baseline mismatches: ${currentMistakes.join(', ')}`);
    assert.deepEqual((await runKeywordBaseline(corpus)).map(value => value.assignedTags), results.map(value => value.assignedTags));
  } finally { globalThis.fetch = originalFetch; }
});
