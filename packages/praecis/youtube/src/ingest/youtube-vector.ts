// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { VectorSpec, IContextProvider } from '@aidha/praecis-core';
import type { RawSource, ExtractionContext } from '@aidha/praecis-core';
import type { ResolvedConfig } from '@aidha/config';
import type { YouTubeClient } from '../client/types.js';
import { YouTubeIngestor } from './youtube-ingestor.js';
import { TranscriptDecodeStrategy } from './transcript-decode-strategy.js';
import { YouTubeSourceRegistration, SOURCE_ID } from '../config/youtube-source-adapter.js';

// ── No-op context provider for Phase 0 ───────────────────────────────────────

class NoOpContextProvider implements IContextProvider {
  async build(_raw: RawSource, _userConfig: ResolvedConfig): Promise<ExtractionContext> {
    return {};
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createYouTubeVectorSpec(client: YouTubeClient): VectorSpec {
  return {
    sourceId: SOURCE_ID,
    sensitivity: 'public',
    ingestor: new YouTubeIngestor(client),
    decode: [new TranscriptDecodeStrategy()],
    context: new NoOpContextProvider(),
    chunking: 'token-window',
    registration: YouTubeSourceRegistration,
  };
}
