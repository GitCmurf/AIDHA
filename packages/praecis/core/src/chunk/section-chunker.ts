// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { IChunker, ChunkInput, Chunk } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';

export class SectionChunker implements IChunker {
  readonly name = 'section';

  async chunk(_input: ChunkInput): Promise<Result<Chunk[]>> {
    return {
      ok: false,
      error: new Error('SectionChunker not yet implemented — ships in Phase 1'),
    };
  }
}
