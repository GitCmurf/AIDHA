// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { VectorSpec, IContextProvider } from '@aidha/praecis-core';
import type { RawSource, ExtractionContext } from '@aidha/praecis-core';
import type { ResolvedConfig } from '@aidha/config';
import type { YouTubeClient } from '../client/types.js';
import { YouTubeIngestor } from './youtube-ingestor.js';
import { TranscriptDecodeStrategy } from './transcript-decode-strategy.js';
import { YouTubeSourceRegistration, SOURCE_ID } from '../config/youtube-source-adapter.js';

// ── YouTube context provider ─────────────────────────────────────────────────

class YouTubeContextProvider implements IContextProvider {
  async build(raw: RawSource, _userConfig: ResolvedConfig): Promise<ExtractionContext> {
    const payload = raw.payload as {
      title?: string;
      channelName?: string;
      description?: string;
    } | undefined;
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

export function createYouTubeVectorSpec(options: YouTubeVectorOptions): VectorSpec {
  return {
    sourceId: SOURCE_ID,
    sensitivity: 'public',
    ingestor: new YouTubeIngestor(options.client),
    decode: [new TranscriptDecodeStrategy()],
    context: new YouTubeContextProvider(),
    chunking: 'token-window',
    registration: YouTubeSourceRegistration,
  };
}
