import { expect, it } from 'vitest';
import * as core from '../../../src/index.js';

it('exposes validation entrypoints through the core package boundary', () => {
  for (const name of [
    'parseSourceDistillation', 'distillationResponseSchema', 'verifyQuote',
    'verifyDistillationEvidence', 'computeCoverage', 'projectUnit',
  ]) expect(core).toHaveProperty(name, expect.any(Function));
});

it('keeps mechanical acceptance separate from semantic entailment', () => {
  const text = 'The synthetic log records that the red indicator stayed switched off throughout the test. Several independent checks recorded the same condition, while the green indicator flashed once at startup.';
  const input = {
    schemaVersion: 1,
    sourceType: 'other',
    sourceCoherence: 'single_topic',
    theses: [],
    units: [{
      id: 'u1', kind: 'fact',
      // This contradicts the source. Mechanical checks deliberately cannot detect that.
      text: 'The red indicator stayed lit throughout the test.',
      importance: 'core', stance: 'asserted',
      evidence: [{ excerptId: 'ex1', quote: 'the red indicator stayed switched off' }],
    }],
  };
  const parsed = core.parseSourceDistillation(JSON.stringify(input), new Set(['ex1']));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const verified = core.verifyDistillationEvidence(parsed.value.units, new Map([['ex1', text]]));
  expect(verified).toEqual({
    units: [{ ...input.units[0], evidence: [{
      excerptId: 'ex1', quote: 'the red indicator stayed switched off', quoteVerification: 'exact',
    }] }],
    failedUnitIds: [], weakQuoteCount: 0, failureRatio: 0,
  });
  expect(core.computeCoverage(verified.units, [{ id: 'ex1', text }])).toEqual({
    citedExcerptCount: 1, excerptsCitedPercent: 100, citedTextPercent: 100,
    largestUncitedGapSeconds: 0, coreUnitsWithoutVerifiedEvidence: 0, weakQuoteCount: 0,
  });
  expect(core.projectUnit('knowledge_graph', 'other', 'fact', 'core')).toBe('claim');
  // Semantic grounding and runtime acceptance must still decide whether to accept it.
});
