// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { IChunker, ChunkInput, Chunk } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';
import type { MediaSegment, Locator } from '../types/index.js';
import { createHash } from 'node:crypto';
import { normalizeText } from '../utils/index.js';

function chunkId(firstSegment: MediaSegment, index: number, label: string): string {
  return createHash('sha256')
    .update(`section:${index}:${firstSegment.id}:${label}`)
    .digest('hex')
    .slice(0, 16);
}

function sectionLocator(segments: readonly MediaSegment[]): Locator {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (first.locator.kind === 'timecode' && last.locator.kind === 'timecode') {
    return {
      kind: 'timecode',
      startSec: first.locator.startSec,
      endSec: last.locator.endSec,
      ...(first.locator.speaker || last.locator.speaker
        ? { speaker: first.locator.speaker ?? last.locator.speaker }
        : {}),
    };
  }
  if (first.locator.kind === 'page' && last.locator.kind === 'page') {
    return {
      kind: 'page',
      page: first.locator.page,
      charStart: first.locator.charStart,
      charEnd: last.locator.charEnd,
    };
  }
  if (first.locator.kind === 'text' && last.locator.kind === 'text') {
    return {
      kind: 'text',
      charStart: first.locator.charStart,
      charEnd: last.locator.charEnd,
    };
  }
  return first.locator;
}

export class SectionChunker implements IChunker {
  readonly name = 'section';

  async chunk(input: ChunkInput): Promise<Result<Chunk[]>> {
    if (input.segments.length === 0) {
      return { ok: true, value: [] };
    }

    const chunks: Chunk[] = [];
    let current: MediaSegment[] = [];
    let currentLabel: string | undefined;
    let index = 0;

    const flush = () => {
      if (current.length === 0) return;
      const label = currentLabel ?? 'section';
      chunks.push({
        id: chunkId(current[0]!, index++, label),
        segments: [...current],
        text: current.map(segment => segment.text ?? '').map(normalizeText).filter(Boolean).join(' ').trim(),
        locator: sectionLocator(current),
      });
      current = [];
      currentLabel = undefined;
    };

    for (const segment of input.segments) {
      const segmentLabel = normalizeText(segment.label ?? '');
      const nextLabel = segmentLabel.length > 0 ? segmentLabel : undefined;

      if (current.length > 0 && currentLabel !== nextLabel) {
        flush();
      }

      currentLabel = nextLabel;
      current.push(segment);
    }

    flush();
    return { ok: true, value: chunks };
  }
}
