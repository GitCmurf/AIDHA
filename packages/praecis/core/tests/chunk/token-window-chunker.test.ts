// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { TokenWindowChunker } from '../../src/chunk/token-window-chunker.js';
import type { MediaSegment, ExtractionContext } from '../../src/types/index.js';

function makeTimecode(id: string, startSec: number, endSec: number, text: string): MediaSegment {
  return { id, locator: { kind: 'timecode', startSec, endSec }, text };
}
function makeText(id: string, charStart: number, charEnd: number, text: string): MediaSegment {
  return { id, locator: { kind: 'text', charStart, charEnd }, text };
}

const ctx: ExtractionContext = {};

describe('TokenWindowChunker', () => {
  it('empty segments returns empty chunks', async () => {
    const r = await new TokenWindowChunker().chunk({ segments: [], context: ctx });
    expect(r.ok).toBe(true);
    if (!r.ok) throw r.error;
    expect(r.value).toHaveLength(0);
  });

  it('groups segments into multiple windows', async () => {
    const segs = Array.from({ length: 12 }, (_, i) =>
      makeTimecode(`s${i}`, i * 5, i * 5 + 5, 'hello world')
    );
    const r = await new TokenWindowChunker({ targetTokens: 10, maxTokens: 15 }).chunk({ segments: segs, context: ctx });
    expect(r.ok).toBe(true);
    if (!r.ok) throw r.error;
    expect(r.value.length).toBeGreaterThan(1);
    expect(r.value.reduce((s, c) => s + c.segments.length, 0)).toBe(12);
  });

  it('timecode span locator covers first.startSec to last.endSec', async () => {
    const segs = [makeTimecode('a', 0, 10, 'hello'), makeTimecode('b', 10, 20, 'world')];
    const r = await new TokenWindowChunker({ targetTokens: 1000 }).chunk({ segments: segs, context: ctx });
    expect(r.ok).toBe(true);
    if (!r.ok) throw r.error;
    expect(r.value).toHaveLength(1);
    const loc = r.value[0]!.locator;
    expect(loc.kind).toBe('timecode');
    if (loc.kind === 'timecode') { expect(loc.startSec).toBe(0); expect(loc.endSec).toBe(20); }
  });

  it('text span locator covers first.charStart to last.charEnd', async () => {
    const segs = [makeText('a', 0, 50, 'first'), makeText('b', 50, 100, 'second')];
    const r = await new TokenWindowChunker({ targetTokens: 1000 }).chunk({ segments: segs, context: ctx });
    expect(r.ok).toBe(true);
    if (!r.ok) throw r.error;
    expect(r.value).toHaveLength(1);
    const loc = r.value[0]!.locator;
    expect(loc.kind).toBe('text');
    if (loc.kind === 'text') { expect(loc.charStart).toBe(0); expect(loc.charEnd).toBe(100); }
  });

  it('oversized segment forms its own chunk', async () => {
    const segs = [makeTimecode('big', 0, 60, 'word '.repeat(300)), makeTimecode('small', 60, 65, 'hi')];
    const r = await new TokenWindowChunker({ targetTokens: 50, maxTokens: 100 }).chunk({ segments: segs, context: ctx });
    expect(r.ok).toBe(true);
    if (!r.ok) throw r.error;
    expect(r.value.length).toBeGreaterThanOrEqual(2);
    expect(r.value[0]!.segments[0]!.id).toBe('big');
  });

  it('chunk text is joined segment texts', async () => {
    const segs = [makeTimecode('a', 0, 5, 'hello'), makeTimecode('b', 5, 10, 'world')];
    const r = await new TokenWindowChunker({ targetTokens: 1000 }).chunk({ segments: segs, context: ctx });
    expect(r.ok).toBe(true);
    if (!r.ok) throw r.error;
    expect(r.value[0]!.text).toBe('hello world');
  });

  it('chunk ids are unique and stable across runs', async () => {
    const segs = Array.from({ length: 6 }, (_, i) => makeTimecode(`s${i}`, i * 5, i * 5 + 5, 'hello world'));
    const chunker = new TokenWindowChunker({ targetTokens: 5, maxTokens: 10 });
    const r1 = await chunker.chunk({ segments: segs, context: ctx });
    const r2 = await chunker.chunk({ segments: segs, context: ctx });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.map(c => c.id)).toEqual(r2.value.map(c => c.id));
    const ids = r1.value.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
