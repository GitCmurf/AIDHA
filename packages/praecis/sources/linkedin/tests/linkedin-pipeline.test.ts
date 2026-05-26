import { describe, expect, it } from 'vitest';
import { createLinkedInVectorSpec } from '../src/index.js';

describe('LinkedIn paste pipeline', () => {
  it('uses the injected clock for provenance timestamps', async () => {
    const fixedClock = { now: () => new Date('2026-05-25T12:34:56.000Z') };
    const vector = createLinkedInVectorSpec({
      pasteText: 'Clocked paragraph.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
      clock: fixedClock,
    });

    const first = await vector.ingestAndDecode({ ref: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/' });
    const second = await vector.ingestAndDecode({ ref: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok) throw first.error;
    if (!second.ok) throw second.error;
    expect(first.value.raw.provenance.ingestedAt).toBe('2026-05-25T12:34:56.000Z');
    expect(second.value.raw.provenance).toEqual(first.value.raw.provenance);
  });

  it('emits text locators for pasted paragraphs', async () => {
    const vector = createLinkedInVectorSpec({
      pasteText: 'First paragraph.\n\nSecond paragraph.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
    });

    const result = await vector.ingestAndDecode({ ref: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value.raw.sourceType).toBe('linkedin');
    expect(result.value.segments).toHaveLength(2);
    expect(result.value.segments[0]!.locator).toEqual({ kind: 'text', charStart: 0, charEnd: 'First paragraph.'.length });
    expect(result.value.segments[0]!.text).toBe('First paragraph.');
    expect(result.value.segments[1]!.locator.kind).toBe('text');
  });
});
