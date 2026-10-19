// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createRawSource } from '@aidha/praecis-core';
import type { IIngestor, IngestInput, VectorRuntimeContext } from '@aidha/praecis-core';
import type { RawSource } from '@aidha/praecis-core';
import type { Result } from '@aidha/taxonomy';
import type { YouTubeClient } from '../client/types.js';
import { Video } from '../schema/index.js';
import type { Transcript } from '../schema/index.js';
import { SOURCE_ID } from '../config/youtube-source-adapter.js';
import { prepareCreatorNoteMetadata } from './creator-note-metadata.js';
import { CREATOR_NOTE_METADATA_GROUP } from '../schema/creator-note.js';

// ── Payload type ─────────────────────────────────────────────────────────────

export interface YouTubeVideoPayload {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  duration: number;
  publishedAt?: string;
  description?: string;
  thumbnailUrl?: string;
  transcript: Transcript | null;
}

// ── YouTubeIngestor ───────────────────────────────────────────────────────────

export class YouTubeIngestor implements IIngestor<YouTubeVideoPayload> {
  readonly sourceId: string = SOURCE_ID;

  constructor(private readonly client: YouTubeClient) {}

  async acquire(
    input: IngestInput,
    runtimeContext: VectorRuntimeContext,
  ): Promise<Result<RawSource<YouTubeVideoPayload>>> {
    const videoId = input.ref;

    const videoResult = await this.client.fetchVideo(videoId);
    if (!videoResult.ok) {
      return { ok: false, error: videoResult.error };
    }
    const video: Video = videoResult.value;
    const publicationDate = Video.shape.publishedAt.safeParse(video.publishedAt);
    const publishedAt = publicationDate.success ? publicationDate.data : undefined;
    const resourceId = `youtube-${videoId}`;
    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const creatorNote = prepareCreatorNoteMetadata({
      description: video.description,
      acquisition: video.creatorNoteAcquisition,
      storedRetrieval: video.creatorNoteRetrieval === 'stored',
      sourceCanonicalId: resourceId, sourceUrl, now: () => runtimeContext.clock.now().toISOString(),
    });

    const transcriptResult = await this.client.fetchTranscript(videoId);
    const transcript: Transcript | null = transcriptResult.ok ? transcriptResult.value : null;

    const payload: YouTubeVideoPayload = {
      videoId: video.id,
      title: video.title,
      channelId: video.channelId,
      channelName: video.channelName,
      duration: video.duration,
      publishedAt,
      description: creatorNote.description,
      thumbnailUrl: video.thumbnailUrl,
      transcript,
    };

    const raw = createRawSource({
      canonicalId: resourceId,
      dedupKeys: [videoId],
      sourceType: 'youtube',
      sensitivity: 'public',
      sourceUri: sourceUrl,
      clock: runtimeContext.clock,
      resourceMetadataGroups: [{ id: CREATOR_NOTE_METADATA_GROUP.id, fields: [...CREATOR_NOTE_METADATA_GROUP.fields] }],
      resourceMetadata: {
        videoId: video.id,
        channelId: video.channelId,
        channelName: video.channelName,
        duration: video.duration,
        // Null clears a stale date when current acquisition has no valid date.
        publishedAt: publishedAt ?? null,
        ...creatorNote.metadata,
        url: sourceUrl,
        thumbnailUrl: video.thumbnailUrl,
        transcriptStatus: transcript ? 'available' : 'missing',
        ...(transcript?.language ? { transcriptLanguage: transcript.language } : {}),
      },
      label: video.title,
      payload,
    });

    return { ok: true, value: raw };
  }
}
