import { describe, expect, it } from 'vitest';
import {
  buildDistillPrompt,
  buildGroundingPrompt,
  buildConsolidationPrompt,
  buildSectionNotesPrompt,
  DISTILL_PROMPT_VERSION,
} from '../../../src/extract/distill/prompts.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

const excerpts = [
  { id: 'ex1', startSeconds: 0, text: 'First excerpt text about markdown wikis and explicit links.' },
  { id: 'ex2', startSeconds: 60, text: 'Second excerpt text about RAG tradeoffs at enterprise scale.' },
];

describe('buildDistillPrompt', () => {
  const prompt = buildDistillPrompt({ resourceLabel: 'Test Video', extractionIntent: 'knowledge_graph' }, excerpts);

  it('asks the organizing question and forbids padding', () => {
    expect(prompt.system).toMatch(/future reasoning agent/i);
    expect(prompt.system).toMatch(/do not pad/i);
  });

  it('never mentions coverage metrics (anti-gaming)', () => {
    const all = `${prompt.system}\n${prompt.user}`.toLowerCase();
    expect(all).not.toContain('coverage');
    expect(all).not.toContain('percent of excerpts');
  });

  it('embeds excerpts as triple-quoted data with ids', () => {
    expect(prompt.user).toContain('"""');
    expect(prompt.user).toContain('ex1');
    expect(prompt.user).toMatch(/strictly as data/i);
  });

  it('requires verbatim quotes and schema fields', () => {
    expect(prompt.user).toMatch(/verbatim/i);
    expect(prompt.user).toContain('supportsUnitIds');
    expect(prompt.user).toContain('stance');
  });

  it('has a stable prompt version', () => {
    expect(DISTILL_PROMPT_VERSION).toBe('distill-v1');
  });
});

describe('buildGroundingPrompt', () => {
  const unit: VerifiedUnit = {
    id: 'u1',
    kind: 'recommendation',
    text: 'Prefer traditional RAG with current models for production retrieval.',
    rationale: 'Current models work better with established infrastructure.',
    stance: 'recommended',
    importance: 'core',
    evidence: [{ excerptId: 'ex2', quote: 'RAG tradeoffs at enterprise scale', quoteVerification: 'normalized' }],
  };

  it('includes only the unit and its cited excerpt texts', () => {
    const prompt = buildGroundingPrompt([unit], new Map([['ex1', excerpts[0]!.text], ['ex2', excerpts[1]!.text]]));
    expect(prompt.user).toContain('u1');
    expect(prompt.user).toContain(excerpts[1]!.text);
    expect(prompt.user).not.toContain(excerpts[0]!.text);
  });

  it('offers exactly the three verdicts', () => {
    const prompt = buildGroundingPrompt([unit], new Map([['ex2', excerpts[1]!.text]]));
    expect(prompt.user).toContain('grounded');
    expect(prompt.user).toContain('rewrite');
    expect(prompt.user).toContain('ungrounded');
  });
});

describe('buildConsolidationPrompt', () => {
  it('includes unit texts but no transcript', () => {
    const unit: VerifiedUnit = {
      id: 'u1', kind: 'idea', stance: 'asserted', importance: 'core',
      text: 'A canonical idea about markdown wikis, long enough for the schema.',
      evidence: [{ excerptId: 'ex1', quote: 'irrelevant here entirely for this test', quoteVerification: 'exact' }],
    };
    const prompt = buildConsolidationPrompt([unit]);
    expect(prompt.user).toContain('u1');
    expect(prompt.user).not.toContain(excerpts[0]!.text);
    expect(prompt.user).toContain('merged_duplicate');
  });
});

describe('buildSectionNotesPrompt', () => {
  it('demands high recall and verbatim snippets', () => {
    const prompt = buildSectionNotesPrompt({ resourceLabel: 'Test Video', sectionIndex: 0, sectionCount: 3 }, excerpts);
    expect(prompt.system).toMatch(/high[- ]recall/i);
    expect(prompt.user).toMatch(/verbatim/i);
    expect(prompt.user).toMatch(/possibly important/i);
  });
});
