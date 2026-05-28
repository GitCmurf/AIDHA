// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { ComposedVector, IContextProvider } from '@aidha/praecis-core';
import type { RawSource, ExtractionContext } from '@aidha/praecis-core';
import { composeVector } from '@aidha/praecis-core';
import type { ResolvedConfig } from '@aidha/config';
import type { YouTubeClient } from '../client/types.js';
import { YouTubeIngestor, type YouTubeVideoPayload } from './youtube-ingestor.js';
import { TranscriptDecodeStrategy } from './transcript-decode-strategy.js';
import { YouTubeSourceRegistration, SOURCE_ID } from '../config/youtube-source-adapter.js';

// ── YouTube context provider ─────────────────────────────────────────────────

class YouTubeContextProvider implements IContextProvider<YouTubeVideoPayload> {
  async build(raw: RawSource<YouTubeVideoPayload>, _userConfig: ResolvedConfig): Promise<ExtractionContext> {
    const payload = raw.payload;
    return {
      sourceSummary: [
        payload?.title,
        payload?.channelName ? `Channel: ${payload.channelName}` : undefined,
        payload?.description,
      ].filter(Boolean).join('\n'),
      chunkingHints: ['conversation'],
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface YouTubeVectorOptions {
  readonly client: YouTubeClient;
}

export function createYouTubeVectorSpec(options: YouTubeVectorOptions): ComposedVector<YouTubeVideoPayload> {
  return composeVector({
    sourceId: SOURCE_ID,
    sensitivity: 'public',
    ingestor: new YouTubeIngestor(options.client),
    decode: [new TranscriptDecodeStrategy()],
    context: new YouTubeContextProvider(),
    chunking: 'token-window',
    registration: YouTubeSourceRegistration,
  });
}
