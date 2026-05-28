// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { MockOcrEngine, ocrBlocksToResult } from '../src/index.js';

describe('ocrBlocksToResult', () => {
  it('converts blocks into text segments', () => {
    const result = ocrBlocksToResult([
      {
        lines: [
          { text: 'Hello' },
          { text: 'world' },
        ],
      },
    ]);

    expect(result.text).toBe('Hello\n\nworld');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]!.locator).toEqual({ kind: 'text', charStart: 0, charEnd: 5 });
    expect(result.segments[1]!.locator).toEqual({ kind: 'text', charStart: 7, charEnd: 12 });
  });
});

describe('MockOcrEngine', () => {
  it('uses configured blocks when provided', async () => {
    const engine = new MockOcrEngine({
      blocks: [
        { lines: [{ text: 'First line' }] },
        { lines: [{ text: 'Second line' }] },
      ],
    });

    const result = await engine.ocr({
      image: { uri: 'file:///page-1.png', mimeType: 'image/png', page: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.text).toBe('First line\n\nSecond line');
  });

  it('falls back to configured text when no blocks are provided', async () => {
    const engine = new MockOcrEngine({ text: 'fallback text' });
    const result = await engine.ocr({
      image: { uri: 'file:///page-1.png', mimeType: 'image/png', page: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.text).toBe('fallback text');
  });

  it('is deterministic for identical input', async () => {
    const engine = new MockOcrEngine({
      blocks: [{ lines: [{ text: 'alpha' }, { text: 'beta' }] }],
    });

    const first = await engine.ocr({ image: { uri: 'file:///page-1.png', mimeType: 'image/png' } });
    const second = await engine.ocr({ image: { uri: 'file:///page-1.png', mimeType: 'image/png' } });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toEqual(second.value);
  });
});
