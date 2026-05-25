import { describe, expect, it } from 'vitest';
import { composeVector } from '@aidha/praecis-core';
import { classifyPdfPayload, createPdfVectorSpec } from '../src/index.js';

describe('PDF slide-vs-paper routing', () => {
  it('classifies sparse bullet-heavy pages as slides', () => {
    expect(classifyPdfPayload({
      filePath: '/tmp/deck.pdf',
      title: 'strategy-deck.pdf',
      sha256: 'deck',
      pages: [
        { pageNumber: 1, text: 'Quarterly plan\n- Growth\n- Risks\n- Decisions' },
        { pageNumber: 2, text: 'Operating model\n- Teams\n- Interfaces' },
      ],
    })).toBe('slides');
  });

  it('classifies dense prose pages as papers', () => {
    const dense = 'This section presents a long-form discussion with sustained prose, methods, findings, limitations, and implications. '.repeat(20);
    expect(classifyPdfPayload({
      filePath: '/tmp/paper.pdf',
      title: 'research-paper.pdf',
      sha256: 'paper',
      pages: [
        { pageNumber: 1, text: dense },
        { pageNumber: 2, text: dense },
      ],
    })).toBe('paper');
  });

  it('sets slide context hints and uses section chunking for deck-like PDFs', async () => {
    const vector = composeVector(createPdfVectorSpec(async () => Buffer.from('Slide one\n- A\n- B\fSlide two\n- C\n- D', 'utf8')));
    const decoded = await vector.ingestAndDecode({ ref: '/tmp/slides.pdf' });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw decoded.error;

    const context = await vector.context.build(decoded.value.raw, {} as Parameters<typeof vector.context.build>[1]);
    const chunks = await vector.chunking.chunk({ segments: decoded.value.segments, context });

    expect(context.domainHints).toContain('slides');
    expect(context.chunkingHints).toContain('slides');
    expect(chunks.ok).toBe(true);
    if (!chunks.ok) throw chunks.error;
    expect(chunks.value).toHaveLength(2);
  });

  it('sets prose context hints and uses token-window chunking for paper-like PDFs', async () => {
    const dense = 'This paper contains enough dense prose to be grouped by token windows rather than page sections. '.repeat(80);
    const vector = composeVector(createPdfVectorSpec(async () => Buffer.from(`${dense}\f${dense}`, 'utf8')));
    const decoded = await vector.ingestAndDecode({ ref: '/tmp/paper.pdf' });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw decoded.error;

    const context = await vector.context.build(decoded.value.raw, {} as Parameters<typeof vector.context.build>[1]);
    const chunks = await vector.chunking.chunk({ segments: decoded.value.segments, context });

    expect(context.domainHints).toContain('paper');
    expect(context.chunkingHints).toContain('prose');
    expect(chunks.ok).toBe(true);
    if (!chunks.ok) throw chunks.error;
    expect(chunks.value.length).toBeGreaterThanOrEqual(1);
  });
});
