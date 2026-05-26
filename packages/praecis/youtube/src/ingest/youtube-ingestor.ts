// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Clock, IIngestor, IngestInput } from '@aidha/praecis-core';
import type { RawSource } from '@aidha/praecis-core';
import type { Result } from '@aidha/taxonomy';
import type { YouTubeClient } from '../client/types.js';
import type { Video } from '../schema/index.js';
import type { Transcript } from '../schema/index.js';
import { SOURCE_ID } from '../config/youtube-source-adapter.js';

// ── Payload type ─────────────────────────────────────────────────────────────

export interface YouTubeVideoPayload {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  duration: number;
  publishedAt: string;
  description?: string;
  thumbnailUrl?: string;
  transcript: Transcript | null;
}

// ── YouTubeIngestor ───────────────────────────────────────────────────────────

export class YouTubeIngestor implements IIngestor<YouTubeVideoPayload> {
  readonly sourceId: string = SOURCE_ID;

  constructor(private readonly client: YouTubeClient, private readonly clock?: Clock) {}

  async acquire(
    input: IngestInput,
  ): Promise<Result<RawSource & { payload: YouTubeVideoPayload }>> {
    const videoId = input.ref;

    const videoResult = await this.client.fetchVideo(videoId);
    if (!videoResult.ok) {
      return { ok: false, error: videoResult.error };
    }
    const video: Video = videoResult.value;

    const transcriptResult = await this.client.fetchTranscript(videoId);
    const transcript: Transcript | null = transcriptResult.ok ? transcriptResult.value : null;

    const payload: YouTubeVideoPayload = {
      videoId: video.id,
      title: video.title,
      channelId: video.channelId,
      channelName: video.channelName,
      duration: video.duration,
      publishedAt: video.publishedAt,
      description: video.description,
      thumbnailUrl: video.thumbnailUrl,
      transcript,
    };

    const raw: RawSource & { payload: YouTubeVideoPayload } = {
      canonicalId: `youtube-${videoId}`,
      dedupKeys: [videoId],
      sourceType: 'youtube',
      sensitivity: 'public',
      provenance: {
        sourceUri: `https://www.youtube.com/watch?v=${videoId}`,
        ingestedAt: (this.clock?.now() ?? new Date()).toISOString(),
        sourceType: 'youtube',
      },
      resourceMetadata: {
        videoId: video.id,
        channelId: video.channelId,
        channelName: video.channelName,
        duration: video.duration,
        publishedAt: video.publishedAt,
        description: video.description,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: video.thumbnailUrl,
        transcriptStatus: transcript ? 'available' : 'missing',
        ...(transcript?.language ? { transcriptLanguage: transcript.language } : {}),
      },
      label: video.title,
      payload,
    };

    return { ok: true, value: raw };
  }
}
