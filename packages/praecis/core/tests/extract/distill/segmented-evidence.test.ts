import { expect, it } from 'vitest';
import { prepareSegmentedEvidence, segmentOverlongQuote } from '../../../src/extract/distill/segmented-evidence.js';
import { verifyDistillationEvidence } from '../../../src/extract/distill/quote-verification.js';
import type { KnowledgeUnit } from '../../../src/extract/distill/schema.js';

const excerpt = "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning. Until then, keep the existing eight-unit threshold outside the five trial machines. This is a conditional recommendation by the operations lead, distinct from the supplier's original six-unit proposal. The regulator attended as an observer and gave no endorsement or threshold instruction at the meeting.";
const quote = "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning. Until then, keep the existing eight-unit threshold outside the five trial machines.";
const original: KnowledgeUnit = { id: 'u4', kind: 'recommendation',
  text: 'Keep eight units outside the five trial machines until the four-week nuisance-alert condition is met.',
  stance: 'recommended', importance: 'core', evidence: [{ excerptId: 'alert-3', quote }] };
const source = new Map([['alert-3', excerpt]]);

it('preserves the complete original literal quote as exact ordered source segments', () => {
  const segments = segmentOverlongQuote(quote, excerpt);
  expect(segments).toEqual([
    "The operations lead's recommendation is to consider a wider trial only if the nuisance-alert share falls below one in ten for four consecutive weeks after tuning.",
    'Until then, keep the existing eight-unit threshold outside the five trial machines.',
  ]);
  expect(segments?.join(' ')).toBe(quote);
});

it('retains every already-valid citation in its original order and audits only new segments as replacements', () => {
  const valid = { excerptId: 'alert-3', quote: 'The regulator attended as an observer and gave no endorsement or threshold instruction at the meeting.' };
  const unit = { ...original, evidence: [valid, ...original.evidence] };
  const checked = verifyDistillationEvidence([unit], source);
  const repaired = prepareSegmentedEvidence(checked.units, source);
  expect(repaired.repaired).toHaveLength(1);
  expect(repaired.records[0]?.replacementEvidence).toHaveLength(2);
  expect(repaired.records[0]?.finalEvidence[0]).toEqual({ ...valid, quoteVerification: 'exact' });
  expect(repaired.records[0]?.finalEvidence).toEqual(repaired.repaired[0]?.evidence);
});

it('retains a pre-existing normalized-valid citation while newly split passages must be exact', () => {
  const normalizedValid = { excerptId: 'alert-3',
    quote: 'the regulator attended as an observer and gave no endorsement or threshold instruction at the meeting.' };
  const checked = verifyDistillationEvidence([{ ...original,
    evidence: [normalizedValid, ...original.evidence] }], source);
  expect(checked.units[0]?.evidence[0]?.quoteVerification).toBe('normalized');
  const repaired = prepareSegmentedEvidence(checked.units, source);
  expect(repaired.records[0]?.finalEvidence[0]).toEqual({ ...normalizedValid,
    quoteVerification: 'normalized' });
  expect(repaired.records[0]?.replacementEvidence.every(reference => reference.quoteVerification === 'exact')).toBe(true);
});

it('cannot launder a fabricated reference alongside an exact overlong reference', () => {
  const unit = { ...original, evidence: [...original.evidence,
    { excerptId: 'alert-3', quote: 'The regulator ordered an immediate six-unit threshold for all machines.' }] };
  const checked = verifyDistillationEvidence([unit], source);
  expect(prepareSegmentedEvidence(checked.units, source)).toEqual({ repaired: [], records: [] });
});

it('leaves an exact overlong quote rejected when all complete pieces cannot pass the five-word rule', () => {
  const shortSource = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima.';
  const tooShortToSplit = 'Alpha bravo charlie delta echo foxtrot golf';
  expect(segmentOverlongQuote(tooShortToSplit, shortSource)).toBeNull();
});

it('rejects normalized-only or source-expanded quotations instead of segmenting them', () => {
  expect(segmentOverlongQuote(quote.toLowerCase(), excerpt)).toBeNull();
  expect(segmentOverlongQuote(`${quote} An official ordered rollout.`, excerpt)).toBeNull();
});

it('does not attempt an unbounded number of failed references on one candidate', () => {
  const manyReferences = { ...original,
    evidence: Array.from({ length: 5 }, () => ({ excerptId: 'alert-3', quote })) };
  const checked = verifyDistillationEvidence([manyReferences], source);
  expect(prepareSegmentedEvidence(checked.units, source)).toEqual({ repaired: [], records: [] });
});

it('splits a long single sentence at balanced word boundaries within the fixed verification budget', () => {
  const words = Array.from({ length: 600 }, (_, index) => `v${String(index).padStart(4, '0')}`);
  const longExcerpt = words.join(' ');
  const longQuote = words.slice(0, 550).join(' ');
  const pieces = segmentOverlongQuote(longQuote, longExcerpt);
  expect(pieces).toHaveLength(2);
  expect(pieces?.join(' ')).toBe(longQuote);
});

it('bounds failed references across the source without partially repairing later candidates', () => {
  const units = Array.from({ length: 3 }, (_, index) => ({ ...original, id: `u${index}`,
    evidence: Array.from({ length: 3 }, () => ({ excerptId: 'alert-3', quote })) }));
  const checked = verifyDistillationEvidence(units, source);
  const repaired = prepareSegmentedEvidence(checked.units, source);
  expect(repaired.records.map(record => record.unitId)).toEqual(['u0', 'u1']);
  expect(repaired.repaired.map(unit => unit.id)).toEqual(['u0', 'u1']);
  expect(repaired.records.every(record => record.replacementEvidence.length <= 12)).toBe(true);
});

it('refuses source-exact inputs beyond the quotation and excerpt size gates', () => {
  const longWords = Array.from({ length: 1000 }, (_, index) => `v${String(index).padStart(4, '0')}`);
  const longQuote = longWords.slice(0, 900).join(' ');
  expect(longQuote.length).toBeGreaterThan(4096);
  expect(segmentOverlongQuote(longQuote, longWords.join(' '))).toBeNull();

  const shortWords = Array.from({ length: 100 }, (_, index) => `w${String(index).padStart(3, '0')}`);
  const shortQuote = shortWords.slice(0, 60).join(' ');
  const oversizedExcerpt = [...shortWords.slice(0, 60),
    ...shortWords.slice(60).map(word => `${word}${'x'.repeat(410)}`)].join(' ');
  expect(shortQuote.length).toBeLessThan(4096);
  expect(oversizedExcerpt.length).toBeGreaterThan(16000);
  expect(segmentOverlongQuote(shortQuote, oversizedExcerpt)).toBeNull();
});
