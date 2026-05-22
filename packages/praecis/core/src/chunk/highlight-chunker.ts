// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { IChunker, ChunkInput, Chunk, MediaSegment } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';

function chunkText(segment: MediaSegment): string {
  return (segment.text ?? segment.label ?? '').trim();
}

export class HighlightChunker implements IChunker {
  readonly name = 'highlight';

  async chunk(input: ChunkInput): Promise<Result<Chunk[]>> {
    return {
      ok: true,
      value: input.segments.map(segment => ({
        id: segment.id,
        segments: [segment],
        text: chunkText(segment),
        locator: segment.locator,
      })),
    };
  }
}
