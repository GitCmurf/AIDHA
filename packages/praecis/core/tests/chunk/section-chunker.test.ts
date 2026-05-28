// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { SectionChunker } from '../../src/chunk/section-chunker.js';
import type { ExtractionContext, MediaSegment } from '../../src/types/index.js';

const context: ExtractionContext = {};

function textSegment(id: string, charStart: number, charEnd: number, text: string, label?: string): MediaSegment {
  return {
    id,
    locator: { kind: 'text', charStart, charEnd },
    text,
    ...(label ? { label } : {}),
  };
}

describe('SectionChunker', () => {
  it('returns empty chunks for empty input', async () => {
    const result = await new SectionChunker().chunk({ segments: [], context });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toEqual([]);
  });

  it('groups contiguous labelled segments into section chunks', async () => {
    const segs = [
      textSegment('s1', 0, 5, 'alpha', 'Intro'),
      textSegment('s2', 5, 10, 'beta', 'Intro'),
      textSegment('s3', 10, 15, 'gamma', 'Body'),
    ];

    const result = await new SectionChunker().chunk({ segments: segs, context });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.text).toBe('alpha beta');
    expect(result.value[1]!.text).toBe('gamma');
    expect(result.value[0]!.locator.kind).toBe('text');
  });

  it('keeps unlabelled segments together', async () => {
    const segs = [
      textSegment('s1', 0, 5, 'alpha'),
      textSegment('s2', 5, 10, 'beta'),
    ];

    const result = await new SectionChunker().chunk({ segments: segs, context });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.text).toBe('alpha beta');
  });
});
