import { describe, expect, it } from 'vitest';
import {
  verifyQuote,
  verifyDistillationEvidence,
} from '../../../src/extract/distill/quote-verification.js';
import type { KnowledgeUnit } from '../../../src/extract/distill/schema.js';

const excerpt = 'So the agent reads index files, and follows explicit links — instead of using embedding similarity over chunks. That is the whole trick really.';

const unit = (overrides: Partial<KnowledgeUnit> = {}): KnowledgeUnit => {
  return {
    id: 'u1',
    kind: 'idea',
    text: 'Agents can navigate a markdown wiki by reading index files and following explicit links.',
    stance: 'asserted',
    evidence: [{ excerptId: 'ex1', quote: 'reads index files, and follows explicit links' }],
    importance: 'core',
    ...overrides,
  };
};

describe('verifyQuote', () => {
  it('returns exact for verbatim substrings', () => {
    expect(verifyQuote('reads index files, and follows explicit links', excerpt)).toBe('exact');
  });

  it('returns normalized when only case or whitespace differs', () => {
    expect(verifyQuote('Reads index files,  and follows explicit links', excerpt)).toBe('normalized');
  });

  it('rejects approximate wording even when most quote tokens appear in a window', () => {
    expect(verifyQuote('the agent reads the index files and follows the explicit links', excerpt)).toBe('failed');
  });

  it('returns failed for fabricated quotes', () => {
    expect(verifyQuote('vector databases always outperform markdown wikis at any scale', excerpt)).toBe('failed');
  });

  it('returns failed for quotes under five words', () => {
    expect(verifyQuote('explicit links', excerpt)).toBe('failed');
  });

  it('returns failed for quotes spanning more than half the excerpt', () => {
    const broad = excerpt.slice(0, Math.ceil(excerpt.length * 0.8));
    expect(verifyQuote(broad, excerpt)).toBe('failed');
  });

  it('returns failed for low-diversity repeated-token quotes', () => {
    expect(verifyQuote('I think I think I think I think I think', excerpt)).toBe('failed');
  });

  it.each([
    ['effective signals improve the device output', 'ineffective signals improve the device output'],
    ['15 samples entered the final batch', '-15 samples entered the final batch'],
    ['the final batch contained 15', 'the final batch contained 15.5 samples'],
    ['the final batch contained 15.', 'the final batch contained 15.5 samples'],
    ['.15 samples entered the final batch', '0.15 samples entered the final batch'],
    ['.15 samples entered the final batch', '-.15 samples entered the final batch'],
    ['+15 samples entered the final batch', '1e+15 samples entered the final batch'],
    ['𐐀 samples entered the final batch', '𐐁𐐀 samples entered the final batch'],
    ['the final batch contained 𐐀', 'the final batch contained 𐐀𐐁 samples'],
  ])('rejects truncated word or number spans: %s', (quote, fragment) => {
    const context = `The synthetic record gives detailed context before the statement ${fragment} and records several additional observations after it.`;
    expect(verifyQuote(quote, context)).toBe('failed');
  });

  it('normalizes compatibility characters and curly quotes without paraphrasing', () => {
    const context = "The synthetic record states that the device's red indicator stayed off and describes several other readings with their timestamps afterwards.";
    expect(verifyQuote('the device’s red indicator stayed off', context)).toBe('normalized');
    const compatibility = 'The synthetic record states that the final batch used ＡＳＣＩＩ labels and describes several other readings with their timestamps afterwards.';
    expect(verifyQuote('the final batch used ASCII labels', compatibility)).toBe('normalized');
  });

  it.each([
    '+15 samples entered the final batch',
    '-.15 samples entered the final batch',
    '𐐀 samples entered the final batch',
    'the final batch contained 𐐀',
  ])('preserves complete numeric or Unicode spans: %s', quote => {
    const context = `The synthetic record gives detailed context before the statement ${quote} and records several additional observations after it.`;
    expect(verifyQuote(quote, context)).toBe('exact');
  });
});

describe('verifyDistillationEvidence', () => {
  const excerptTextById = new Map([['ex1', excerpt]]);

  it('annotates evidence with verification status and keeps verified units', () => {
    const result = verifyDistillationEvidence([unit()], excerptTextById);
    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.evidence[0]?.quoteVerification).toBe('exact');
    expect(result.failedUnitIds).toHaveLength(0);
    expect(result.failureRatio).toBe(0);
  });

  it('fails units whose every quote fails', () => {
    const bad = unit({ id: 'u2', evidence: [{ excerptId: 'ex1', quote: 'completely fabricated nonsense about quantum blockchain synergies' }] });
    const result = verifyDistillationEvidence([unit(), bad], excerptTextById);
    expect(result.failedUnitIds).toEqual(['u2']);
    expect(result.failureRatio).toBe(0.5);
  });

  it('rejects a unit with mixed valid and fabricated evidence, counting the weak quote', () => {
    const mixed = unit({
      id: 'u3',
      evidence: [
        { excerptId: 'ex1', quote: 'reads index files, and follows explicit links' },
        { excerptId: 'ex1', quote: 'completely fabricated nonsense about quantum blockchain synergies' },
      ],
    });
    const result = verifyDistillationEvidence([mixed], excerptTextById);
    expect(result.failedUnitIds).toEqual(['u3']);
    expect(result.weakQuoteCount).toBe(1);
  });

  it('rejects timestamps invented inside a quotation', () => {
    expect(verifyQuote('[12:34] reads index files, and follows explicit links', excerpt)).toBe('failed');
  });

  it('fails evidence whose excerptId is missing from the map', () => {
    const missing = unit({ id: 'u9', evidence: [{ excerptId: 'ghost', quote: 'reads index files, and follows explicit links' }] });
    const result = verifyDistillationEvidence([missing], new Map([['ex1', excerpt]]));
    expect(result.failedUnitIds).toEqual(['u9']);
  });
});
