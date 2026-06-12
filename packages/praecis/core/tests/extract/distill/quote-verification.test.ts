import { describe, expect, it } from 'vitest';
import {
  verifyQuote,
  verifyDistillationEvidence,
} from '../../../src/extract/distill/quote-verification.js';
import type { KnowledgeUnit } from '../../../src/extract/distill/schema.js';

const excerpt = 'So the agent reads index files, and follows explicit links — instead of using embedding similarity over chunks. That is the whole trick really.';

function unit(overrides: Partial<KnowledgeUnit> = {}): KnowledgeUnit {
  return {
    id: 'u1',
    kind: 'idea',
    text: 'Agents can navigate a markdown wiki by reading index files and following explicit links.',
    stance: 'asserted',
    evidence: [{ excerptId: 'ex1', quote: 'reads index files, and follows explicit links' }],
    importance: 'core',
    ...overrides,
  };
}

describe('verifyQuote', () => {
  it('returns exact for verbatim substrings', () => {
    expect(verifyQuote('reads index files, and follows explicit links', excerpt)).toBe('exact');
  });

  it('returns normalized when only punctuation/case/whitespace differ', () => {
    expect(verifyQuote('Reads index files and follows explicit links', excerpt)).toBe('normalized');
  });

  it('returns fuzzy when most quote tokens appear in a window', () => {
    expect(verifyQuote('the agent reads the index files and follows the explicit links', excerpt)).toBe('fuzzy');
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

  it('keeps a unit when at least one quote verifies, counting the weak quote', () => {
    const mixed = unit({
      id: 'u3',
      evidence: [
        { excerptId: 'ex1', quote: 'reads index files, and follows explicit links' },
        { excerptId: 'ex1', quote: 'completely fabricated nonsense about quantum blockchain synergies' },
      ],
    });
    const result = verifyDistillationEvidence([mixed], excerptTextById);
    expect(result.failedUnitIds).toHaveLength(0);
    expect(result.weakQuoteCount).toBe(1);
  });

  it('verifies quotes containing timecode artifacts as normalized', () => {
    expect(verifyQuote('[12:34] reads index files and follows explicit links', excerpt)).toBe('normalized');
  });

  it('fails evidence whose excerptId is missing from the map', () => {
    const missing = unit({ id: 'u9', evidence: [{ excerptId: 'ghost', quote: 'reads index files, and follows explicit links' }] });
    const result = verifyDistillationEvidence([missing], new Map([['ex1', excerpt]]));
    expect(result.failedUnitIds).toEqual(['u9']);
  });
});
